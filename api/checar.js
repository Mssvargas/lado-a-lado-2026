// Checagem de uma frase sobre os candidatos contra os planos de governo
// oficiais, as checagens reunidas no site e uma busca ao vivo em agências de
// checagem e veículos jornalísticos.
//
// GET  /api/checar  -> { ok, ia, busca }  (diz o que está configurado; não gasta cota)
// POST /api/checar  { frase, candidato: "ambos"|<id de data/eleicao.json> }
// POST /api/checar  { modo: "espectro", frase }  -> categoria do Manifesto Project + o que o plano diz
// POST /api/checar  { modo: "imagem", imagem: "data:image/...;base64,..." }  -> texto e afirmações do print
// POST /api/checar  { modo: "audio", audio: "<base64>", mime }  -> transcrição da pergunta (Whisper no Groq)
// POST /api/checar  { modo: "extrair", texto }  -> afirmações de um texto lido do print no navegador (OCR)
// POST /api/checar  { modo: "acervo", pergunta, doc? }  -> resposta com artigos do Acervo Constitucional
// POST /api/checar  { modo: "site", pergunta }  -> resposta com fontes de todo o conteúdo do site
//
// Etapas:
//   1. termos de busca (IA rápida; sem IA, usa as palavras da frase)
//   2. trechos dos planos (busca local nos JSON de data/)
//   3. busca ao vivo no Tavily, restrita a domínios de checagem e imprensa
//   4. resposta da IA, só com esse material
//   5. validação: citação que não existe na página e link que não veio da
//      busca são descartados antes de responder
//
// Chaves (variáveis de ambiente, todas opcionais; sem nenhuma IA, o POST
// responde 503 e o site esconde a análise):
//   GROQ_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY
//   TAVILY_API_KEY     busca na web
//   WEB_DOMINIOS       lista de domínios separada por vírgula (entra na frente da padrão)
//   TAVILY_DEPTH       "basic" (padrão, 1 crédito) ou "advanced" (2 créditos, trechos melhores)

const fs = require('fs');
const path = require('path');

const VERSAO = '2026-10-22b';

function fila(env, padrao) {
  const extra = (process.env[env] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  extra.concat(padrao).forEach((m) => { if (out.indexOf(m) < 0) out.push(m); });
  return out;
}

const MODELOS = {
  groq: () => fila('GROQ_MODEL', ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b']),
  cerebras: () => fila('CEREBRAS_MODEL', ['gpt-oss-120b', 'llama-3.3-70b', 'qwen-3-235b-a22b-instruct-2507']),
  openrouter: () => fila('OPENROUTER_MODEL', ['openrouter/free', 'meta-llama/llama-3.3-70b-instruct:free']),
  gemini: () => fila('IA_MODEL', ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.5-flash'])
};
const OPENAI_COMPAT = {
  groq: { env: 'GROQ_API_KEY', url: 'https://api.groq.com/openai/v1/chat/completions' },
  cerebras: { env: 'CEREBRAS_API_KEY', url: 'https://api.cerebras.ai/v1/chat/completions' },
  openrouter: { env: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/api/v1/chat/completions' }
};
const CHAVE = { groq: 'GROQ_API_KEY', cerebras: 'CEREBRAS_API_KEY', openrouter: 'OPENROUTER_API_KEY', gemini: 'GEMINI_API_KEY' };
const ORDEM = ['groq', 'cerebras', 'openrouter', 'gemini'];
const configurados = () => ORDEM.filter((p) => !!process.env[CHAVE[p]]);

// Agências de checagem e veículos de grande circulação, sem veículos de
// linha editorial declaradamente partidária de nenhum dos lados.
const DOMINIOS = () => fila('WEB_DOMINIOS', [
  'agencialupa.org', 'lupa.uol.com.br', 'aosfatos.org', 'projetocomprova.com.br', 'checamos.afp.com',
  'estadao.com.br', 'terra.com.br', 'g1.globo.com', 'noticias.uol.com.br', 'folha.uol.com.br',
  'agenciabrasil.ebc.com.br', 'tse.jus.br', 'justicaeleitoral.jus.br', 'poder360.com.br',
  'bbc.com', 'cnnbrasil.com.br', 'nexojornal.com.br', 'congressoemfoco.com.br'
]);

// Candidatos da eleição atual: data/eleicao.json (o mesmo arquivo que o site usa).
const ELEICAO = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'eleicao.json'), 'utf8'));
const CAND = Object.fromEntries(ELEICAO.candidatos.map((c) => [c.id, c]));
const IDS = ELEICAO.candidatos.map((c) => c.id);
const LISTA_IDS = IDS.join('|');
const DESCRICAO = ELEICAO.candidatos.map((c) => c.nome + ' (' + c.partido + ', nº ' + c.numero + '), "' + c.plano + '"').join('; ');
const LEGENDA_IDS = ELEICAO.candidatos.map((c) => c.id + ' = ' + c.nome + ', ' + c.partido).join('; ');
const CLASSES = ['consta', 'consta_em_parte', 'nao_consta', 'contraria', 'nao_e_proposta'];

// ---------- dados ----------

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const loose = (s) => fold(String(s).replace(/-\s*\n\s*/g, '')).replace(/[^a-z0-9%]+/g, ' ').trim();

let CACHE = null;
function dados() {
  if (CACHE) return CACHE;
  const ler = (n) => JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', n), 'utf8'));
  const planos = {};
  for (const k of Object.keys(CAND)) {
    planos[k] = JSON.parse(fs.readFileSync(path.join(process.cwd(), CAND[k].arquivo), 'utf8')).pages.map((p) => {
      const t = p.t.normalize('NFC');
      return { p: p.p, t, f: fold(t), l: loose(t), toc: (t.match(/\.{8,}/g) || []).length > 3 };
    });
  }
  const esp = ler('espectro.json');
  // Propostas já classificadas: servem de exemplo para a IA seguir o mesmo critério.
  const comp = ler('comparativo.json');
  const exemplos = (esp.itens || []).map((x) => {
    const t = comp.temas.find((tm) => tm.id === x.tema);
    const it = t && t.itens[x.indice];
    return it && it.trecho ? { proposta: it.proposta, categoria: x.categoria, f: fold(it.proposta) } : null;
  }).filter(Boolean);
  CACHE = { planos, checagens: ler('checagens.json').checagens, categorias: esp.categorias || [], exemplos };
  return CACHE;
}

// Acervo Constitucional: textos compilados do Planalto, separados por artigo (tools/acervo.py).
let ACERVO = null;
function acervo() {
  if (ACERVO) return ACERVO;
  const base = path.join(process.cwd(), 'data');
  const idx = JSON.parse(fs.readFileSync(path.join(base, 'acervo.json'), 'utf8')).documentos;
  const docs = {};
  for (const d of idx) {
    const j = JSON.parse(fs.readFileSync(path.join(process.cwd(), d.arquivo), 'utf8'));
    docs[d.id] = {
      id: d.id, titulo: d.titulo, url: d.url, baixado_em: d.baixado_em,
      artigos: j.artigos.map((a) => ({ n: a.n, hier: a.hier, t: a.t, f: fold(a.hier + ' ' + a.t), l: loose(a.t) }))
    };
  }
  ACERVO = { idx, docs };
  return ACERVO;
}

// Respostas recentes: a mesma pergunta não gasta cota de novo (vale por instância).
const RESPOSTAS = new Map(), RESPOSTA_TTL = 6 * 60 * 60 * 1000;
function lembrada(chave) {
  const r = RESPOSTAS.get(chave);
  if (r && Date.now() - r.t < RESPOSTA_TTL) return r.v;
  RESPOSTAS.delete(chave);
  return null;
}
function lembrar(chave, v) {
  if (RESPOSTAS.size > 500) RESPOSTAS.delete(RESPOSTAS.keys().next().value);
  RESPOSTAS.set(chave, { t: Date.now(), v });
}

const STOP = new Set((ELEICAO.candidatos.flatMap((c) => [c.nome].concat(c.apelidos || [])).join(' ') + ' ' + 'a o os as um uma uns umas de do da dos das em no na nos nas por para pra com sem que e ou se ao aos à às é ser foi vai vão vou ir sobre como mais menos muito ' +
  'candidato candidata presidente governo plano proposta propoe propõe propor prometeu promete disse diz dizer quer fazer faz silva ' +
  'seu sua seus suas ele ela eles isso esse essa este esta ja já nao não sim tambem também todo toda todos todas ter tem acabar anos verdade mentira falso mesmo ainda antes depois vez sempre nunca agora hoje dia urgente compartilhe').split(' ').map(fold));

function quemNaFrase(f) {
  for (const c of ELEICAO.candidatos) {
    if ((c.apelidos || [c.nome]).some((a) => new RegExp('\\b' + fold(a).replace(/[^a-z0-9 ]/g, '') + '\\b').test(f))) return c.id;
  }
  return null;
}

// Fala transcrita: "seis por um" / "6 por 1" vira "6x1".
const NUMS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, 'três': 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
const normNum = (q) => String(q).replace(/\b(\d+|um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez)\s+(?:por|x)\s+(\d+|um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez)\b/gi, (m, a, b) => (NUMS[a.toLowerCase()] || a) + 'x' + (NUMS[b.toLowerCase()] || b));

function termos(q) {
  const out = [];
  for (const w of fold(normNum(q)).split(/[^a-z0-9%]+/)) {
    if (w.length < 3 || STOP.has(w)) continue;
    const stem = w.length > 6 ? w.slice(0, w.length - 2) : w;
    if (out.indexOf(stem) < 0) out.push(stem);
  }
  return out;
}

// Palavras de até 3 letras (SUS, PIB, 6x1) só valem como palavra inteira: "sus" não acha "sustentável".
function achar(f, t, de) {
  let i = f.indexOf(t, de || 0);
  if (t.length > 3) return i;
  while (i !== -1 && (/[a-z0-9]/.test(f[i - 1] || '') || /[a-z0-9]/.test(f[i + t.length] || ''))) i = f.indexOf(t, i + 1);
  return i;
}

function pontuar(p, ts) {
  let s = 0, hit = 0;
  for (const t of ts) {
    let i = achar(p.f, t), n = 0;
    while (i !== -1 && n < 8) { n++; i = achar(p.f, t, i + t.length); }
    if (n) { hit++; s += 3 + n; }
  }
  return hit ? s * hit * (p.toc ? 0.2 : 1) : 0;
}

// Trecho da página em volta das palavras buscadas. A página inteira pode passar do
// tamanho que cabe no pedido, e cortar só o começo perdia o trecho que importava.
function janela(p, consultas, max) {
  if (p.t.length <= max) return p.t;
  const ts = [...new Set(consultas.flatMap(termos))];
  const hits = [];
  for (const t of ts) {
    let i = achar(p.f, t);
    while (i !== -1) { hits.push(i); i = achar(p.f, t, i + t.length); }
  }
  if (!hits.length) return p.t.slice(0, max) + '…';
  let inicio = 0, melhor = -1;
  for (const h of hits) {
    const a = Math.max(0, h - 400);
    const n = hits.filter((x) => x >= a && x < a + max).length;
    if (n > melhor) { melhor = n; inicio = a; }
  }
  inicio = Math.max(0, Math.min(inicio, p.t.length - max));
  return (inicio > 0 ? '…' : '') + p.t.slice(inicio, inicio + max) + (inicio + max < p.t.length ? '…' : '');
}

function paginasRelevantes(k, consultas, limite) {
  const placar = new Map();
  for (const q of consultas) {
    const ts = termos(q);
    if (!ts.length) continue;
    for (const p of dados().planos[k]) {
      const s = pontuar(p, ts);
      if (s > 0) placar.set(p.p, (placar.get(p.p) || 0) + s);
    }
  }
  return [...placar.entries()].sort((a, b) => b[1] - a[1]).slice(0, limite)
    .map(([n]) => dados().planos[k].find((p) => p.p === n));
}

// Termos do dia a dia que a lei escreve de outro jeito (a mesma lista do site).
const AC_SINONIMOS = {
  'maioridade penal': 'penalmente inimputaveis menores de dezoito anos',
  'carga horaria': 'duracao do trabalho',
  '6x1': 'duracao do trabalho repouso semanal remunerado',
  'jornada': 'duracao do trabalho normal horas semanais',
  'reeleicao': 'reeleito periodo subsequente',
  'foro privilegiado': 'processar e julgar originariamente',
  'licenca maternidade': 'licenca gestante',
  'salario maternidade': 'licenca gestante',
  'porte de arma': 'porte de arma de fogo',
  'aborto': 'aborto gestante'
};

// Artigos do acervo mais ligados às consultas. "art. 5", "artigo 7º" na pergunta puxam o artigo citado.
// alvos: artigos que a IA apontou como prováveis ("cf|228"). Só ajudam a achar; a resposta usa o texto oficial.
function artigosRelevantes(consultas, docIds, limite, alvos) {
  const A = acervo();
  const alvo = new Set(alvos || []);
  const ids = docIds.filter((d) => A.docs[d]);
  const refs = [];
  // Número de artigo só conta quando vem do texto da pessoa (a primeira consulta).
  for (const q of consultas.slice(0, 1)) {
    const re = /\bart(?:igo)?s?\.?\s*(\d+)/g;
    let m;
    while ((m = re.exec(fold(q)))) refs.push(m[1]);
  }
  const tss = consultas.map(termos).filter((ts) => ts.length);
  const placar = [];
  for (const id of ids.length ? ids : Object.keys(A.docs)) {
    for (const a of A.docs[id].artigos) {
      let s = 0;
      for (const ts of tss) s += pontuar(a, ts);
      const num = (/^Art\. (\d+)/.exec(a.n) || [])[1];
      if (num && refs.indexOf(num) >= 0) s += 400;
      if (alvo.has(id + '|' + normArt(a.n))) s += 300;
      if (s > 0) placar.push({ doc: id, a, s });
    }
  }
  return placar.sort((x, y) => y.s - x.s).slice(0, limite);
}

function exemplosEspectro(frase) {
  const ts = termos(frase);
  if (!ts.length) return [];
  return dados().exemplos.map((x) => ({ x, n: ts.filter((t) => achar(x.f, t) !== -1).length }))
    .filter((y) => y.n).sort((a, b) => b.n - a.n).slice(0, 8).map((y) => y.x);
}

function checagensRelevantes(consultas, cand) {
  const ts = [...new Set(consultas.flatMap(termos))];
  return dados().checagens.map((c, i) => {
    if (cand !== 'ambos' && c.candidato !== cand) return null;
    const f = fold([c.alegacao, c.explicacao, c.tema].join(' '));
    const n = ts.filter((t) => f.includes(t)).length;
    return n ? { c, i, n } : null;
  }).filter(Boolean).sort((a, b) => b.n - a.n).slice(0, 6);
}

// ---------- chamadas ----------

async function comTempo(url, opcoes, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs));
  try {
    const r = await fetch(url, Object.assign({}, opcoes, { signal: ctrl.signal }));
    let data = {};
    try { data = await r.json(); } catch (e) { data = {}; }
    return { http: r.ok, status: r.status, data };
  } catch (e) {
    const ab = e && e.name === 'AbortError';
    return { http: false, status: ab ? 504 : 0, data: { error: { message: ab ? 'tempo esgotado' : 'rede: ' + String((e && e.message) || e) } } };
  } finally {
    clearTimeout(t);
  }
}

function mensagemErro(r) {
  const e = r.data && r.data.error;
  if (!e) return 'HTTP ' + r.status;
  return typeof e === 'string' ? e : (e.message || e.type || 'HTTP ' + r.status);
}

const limparPensamento = (t) => String(t || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

async function chamarOpenAI(prov, prompt, modelo, maxTokens, timeoutMs) {
  const cfg = OPENAI_COMPAT[prov];
  const pedido = { model: modelo, messages: [{ role: 'user', content: prompt }], temperature: 0.1 };
  // Modelos que raciocinam antes de responder (gpt-oss) gastam tokens nisso: com pouco limite,
  // a resposta saía vazia ou cortada. Raciocínio curto e limite com folga.
  const raciocina = /gpt-oss|qwen3|deepseek-r1|openrouter\/free/.test(modelo);
  if (raciocina) maxTokens = Math.max(maxTokens, 3000);
  if (/gpt-oss/.test(modelo) && prov !== 'openrouter') pedido.reasoning_effort = 'low';
  if (prov === 'groq') pedido.max_completion_tokens = maxTokens; else pedido.max_tokens = maxTokens;
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + process.env[cfg.env] };
  if (prov === 'openrouter') headers['X-Title'] = 'Lado a Lado ' + ELEICAO.ano;
  const r = await comTempo(cfg.url, { method: 'POST', headers, body: JSON.stringify(pedido) }, timeoutMs);
  if (!r.http || (r.data && r.data.error)) return { ok: false, status: r.http ? 502 : r.status, msg: mensagemErro(r) };
  const esc = r.data.choices && r.data.choices[0];
  const texto = limparPensamento(esc && esc.message && esc.message.content);
  return texto ? { ok: true, texto } : { ok: false, status: 502, msg: 'nao retornou texto' };
}

async function chamarGemini(prompt, modelo, maxTokens, timeoutMs) {
  const gc = { maxOutputTokens: Math.max(maxTokens, 4096), temperature: 0.1 };
  if (/^gemini-3\.(5|6)/.test(modelo)) gc.thinkingConfig = { thinkingLevel: 'minimal' };
  const r = await comTempo('https://generativelanguage.googleapis.com/v1beta/models/' + modelo + ':generateContent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: gc })
  }, timeoutMs);
  if (!r.http || (r.data && r.data.error)) return { ok: false, status: r.status, msg: mensagemErro(r) };
  const c = r.data.candidates && r.data.candidates[0];
  const texto = c && c.content && c.content.parts ? c.content.parts.map((p) => p.text || '').join('').trim() : '';
  return texto ? { ok: true, texto } : { ok: false, status: 502, msg: 'resposta vazia' };
}

// Modelos que o Groq oferece hoje. Os provedores tiram modelos do ar sem aviso; pular os que
// sumiram evita gastar o prazo da resposta com erro. Sem a lista, tenta todos.
let DISPONIVEIS = null, DISPONIVEIS_EM = 0;
async function carregarDisponiveis() {
  if (!process.env.GROQ_API_KEY || Date.now() - DISPONIVEIS_EM < 60 * 60 * 1000) return;
  DISPONIVEIS_EM = Date.now();
  const r = await comTempo('https://api.groq.com/openai/v1/models', { headers: { authorization: 'Bearer ' + process.env.GROQ_API_KEY } }, 4000);
  const ids = ((r.data && r.data.data) || []).map((m) => m.id);
  DISPONIVEIS = ids.length ? new Set(ids) : null;
}
const disponivel = (prov, modelo) => prov !== 'groq' || !DISPONIVEIS || DISPONIVEIS.has(modelo);

// Percorre provedores e modelos até um responder com JSON válido.
// aceita(json) rejeita resposta no formato certo mas sem conteúdo (ex.: o modelo copiou o molde).
async function perguntar(prompt, maxTokens, prazo, trilha, aceita) {
  await carregarDisponiveis();
  for (const prov of configurados()) {
    for (const modelo of MODELOS[prov]()) {
      if (!disponivel(prov, modelo)) continue;
      let sobra = prazo - Date.now();
      if (sobra < 4000) return null;
      const chamar = () => prov === 'gemini'
        ? chamarGemini(prompt, modelo, maxTokens, Math.min(25000, sobra - 1000))
        : chamarOpenAI(prov, prompt, modelo, maxTokens, Math.min(25000, sobra - 1000));
      let r = await chamar();
      // Limite por minuto do Groq: quando ele pede poucos segundos de espera, vale esperar e repetir.
      const espera = !r.ok && /try again in ([\d.]+)s/i.exec(String(r.msg));
      if (espera && Number(espera[1]) <= 8 && prazo - Date.now() > Number(espera[1]) * 1000 + 8000) {
        trilha.push(prov + ':' + modelo + ': limite por minuto, esperou ' + espera[1] + 's');
        await new Promise((ok) => setTimeout(ok, Number(espera[1]) * 1000 + 300));
        sobra = prazo - Date.now();
        r = await chamar();
      }
      if (!r.ok) { trilha.push(prov + ':' + modelo + ': ' + String(r.msg).slice(0, 120)); continue; }
      const json = extrairJSON(r.texto);
      if (json && (!aceita || aceita(json))) return { json, modelo: prov + ':' + modelo };
      trilha.push(prov + ':' + modelo + ': ' + (json ? 'resposta incompleta' : 'JSON invalido'));
    }
  }
  return null;
}

// ---------- imagem (print) e áudio ----------

const ORDEM_VISAO = ['groq', 'openrouter', 'gemini'];
const MODELOS_VISAO = {
  groq: () => fila('GROQ_MODEL_VISAO', ['qwen/qwen3.8-27b', 'meta-llama/llama-4-scout-17b-16e-instruct']),
  openrouter: () => fila('OPENROUTER_MODEL_VISAO', ['openrouter/free']),
  gemini: () => MODELOS.gemini()
};

function promptImagem() {
  return 'A imagem é um print enviado por um eleitor (post de rede social, notícia, mensagem ou vídeo). ' +
    'Ele quer saber se o que o print diz sobre os candidatos à Presidência do Brasil em ' + ELEICAO.ano + ' (' + LEGENDA_IDS + ') ' +
    'confere com os planos de governo.\n' +
    '1. Em "texto", transcreva literalmente o texto principal da imagem (até 800 caracteres).\n' +
    '2. Em "afirmacoes", liste até 3 afirmações verificáveis sobre os candidatos ou suas propostas, cada uma como frase curta, ' +
    'fiel ao que a imagem diz, citando o nome do candidato. Não julgue, não corrija e não acrescente nada. ' +
    'Se não houver afirmação desse tipo, devolva a lista vazia.\n' +
    'Responda só com JSON: {"texto":"...","afirmacoes":["..."]}';
}

async function lerImagem(dataUrl, prazo, trilha) {
  await carregarDisponiveis();
  const [, mime, b64] = /^data:(image\/[a-z]+);base64,(.*)$/.exec(dataUrl) || [];
  for (const prov of ORDEM_VISAO) {
    if (!process.env[CHAVE[prov]]) continue;
    for (const modelo of MODELOS_VISAO[prov]()) {
      if (!disponivel(prov, modelo)) continue;
      const sobra = prazo - Date.now();
      if (sobra < 4000) return null;
      let r;
      if (prov === 'gemini') {
        const g = await comTempo('https://generativelanguage.googleapis.com/v1beta/models/' + modelo + ':generateContent', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: promptImagem() }, { inline_data: { mime_type: mime, data: b64 } }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 4096 } })
        }, Math.min(25000, sobra - 1000));
        const c = g.data && g.data.candidates && g.data.candidates[0];
        const texto = c && c.content && c.content.parts ? c.content.parts.map((p) => p.text || '').join('') : '';
        r = g.http && texto ? { ok: true, texto } : { ok: false, msg: mensagemErro(g) };
      } else {
        const cfg = OPENAI_COMPAT[prov];
        const pedido = {
          model: modelo, temperature: 0.1,
          messages: [{ role: 'user', content: [{ type: 'text', text: promptImagem() }, { type: 'image_url', image_url: { url: dataUrl } }] }]
        };
        if (prov === 'groq') pedido.max_completion_tokens = 1200; else pedido.max_tokens = 1200;
        const o = await comTempo(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env[cfg.env] }, body: JSON.stringify(pedido) }, Math.min(25000, sobra - 1000));
        const esc = o.data && o.data.choices && o.data.choices[0];
        const texto = limparPensamento(esc && esc.message && esc.message.content);
        r = o.http && !(o.data && o.data.error) && texto ? { ok: true, texto } : { ok: false, msg: mensagemErro(o) };
      }
      if (!r.ok) { trilha.push(prov + ':' + modelo + ': ' + String(r.msg).slice(0, 120)); continue; }
      const json = extrairJSON(r.texto);
      if (json) return { json, modelo: prov + ':' + modelo };
      trilha.push(prov + ':' + modelo + ': JSON invalido');
    }
  }
  return null;
}

async function transcrever(b64, mime, trilha) {
  const ext = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' }[mime] || 'webm';
  for (const modelo of fila('GROQ_MODEL_AUDIO', ['whisper-large-v3-turbo', 'whisper-large-v3'])) {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(b64, 'base64')], { type: mime }), 'pergunta.' + ext);
    form.append('model', modelo);
    form.append('language', 'pt');
    form.append('response_format', 'json');
    form.append('temperature', '0');
    // Vocabulário do assunto: ajuda o Whisper com nomes próprios e siglas da pergunta.
    form.append('prompt', 'Pergunta de um eleitor sobre a eleição presidencial de ' + ELEICAO.ano + ' no Brasil, ' +
      ELEICAO.candidatos.map((c) => c.nome + ' (' + c.partido + ')').join(', ') +
      '. Plano de governo, Constituição Federal, artigo, emenda, escala 6x1, Bolsa Família, SUS, CLT, INSS, imposto de renda, reforma tributária, segurança pública.');
    const r = await comTempo('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { authorization: 'Bearer ' + process.env.GROQ_API_KEY }, body: form
    }, 30000);
    const texto = r.http && r.data && typeof r.data.text === 'string' ? r.data.text.trim() : '';
    if (texto) return normNum(texto);
    trilha.push('groq:' + modelo + ': ' + String(mensagemErro(r)).slice(0, 120));
  }
  return null;
}

function extrairJSON(t) {
  const s = String(t || '').replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(s); } catch (e) { /* tenta o trecho entre chaves */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}

async function pesquisarWeb(consulta, timeoutMs) {
  if (!process.env.TAVILY_API_KEY) return { ok: false, resultados: [] };
  const r = await comTempo('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.TAVILY_API_KEY },
    body: JSON.stringify({
      query: String(consulta).slice(0, 380),
      search_depth: process.env.TAVILY_DEPTH === 'advanced' ? 'advanced' : 'basic',
      max_results: 6,
      time_range: 'year',
      include_domains: DOMINIOS(),
      include_answer: false
    })
  }, timeoutMs);
  if (!r.http) return { ok: false, resultados: [], msg: mensagemErro(r) };
  const resultados = ((r.data && r.data.results) || []).map((x) => ({
    titulo: String(x.title || '').slice(0, 200),
    url: String(x.url || ''),
    fonte: (() => { try { return new URL(x.url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } })(),
    trecho: String(x.content || '').replace(/\s+/g, ' ').slice(0, 900)
  })).filter((x) => /^https:\/\//.test(x.url));
  return { ok: true, resultados };
}

// ---------- limite por IP (melhor esforço: vale por instância) ----------

const JANELA = 10 * 60 * 1000, MAX_POR_JANELA = 8;
const visitas = new Map();
function dentroDoLimite(ip) {
  const agora = Date.now();
  const lista = (visitas.get(ip) || []).filter((t) => agora - t < JANELA);
  if (lista.length >= MAX_POR_JANELA) { visitas.set(ip, lista); return false; }
  lista.push(agora);
  visitas.set(ip, lista);
  if (visitas.size > 5000) visitas.clear();
  return true;
}

// ---------- prompts ----------

function promptTermos(frase) {
  return 'Você prepara buscas para verificar uma frase sobre a eleição presidencial brasileira de ' + ELEICAO.ano + ' (' + LEGENDA_IDS + ').\n' +
    'Frase: """' + frase + '"""\n' +
    'Responda só com JSON: {"sobre":"' + LISTA_IDS + '|ambos|indefinido","consultas_plano":["3 a 5 consultas curtas de 1 a 3 palavras, com sinônimos que um plano de governo usaria"],"consulta_web":"uma consulta curta para achar checagens e reportagens sobre a frase"}';
}

function promptResposta(frase, cand, trechos, fcs, web, consultas) {
  const blocos = [];
  for (const k of Object.keys(trechos)) {
    for (const p of trechos[k]) blocos.push('[PLANO ' + k + ' p.' + p.p + ']\n' + janela(p, consultas, 2400));
  }
  const fcTxt = fcs.map((x) => '[CHECAGEM ' + x.i + '] ' + CAND[x.c.candidato].nome + ' | ' + x.c.alegacao + ' | veredito: ' + x.c.veredito + ' | ' + x.c.fonte + ', ' + x.c.data + ' | ' + x.c.explicacao).join('\n');
  const webTxt = web.map((x, i) => '[WEB ' + i + '] ' + x.fonte + ' | ' + x.titulo + '\n' + x.trecho).join('\n\n');
  const who = cand === 'ambos' ? 'Descubra pelo texto de quem a frase fala; se não der, considere todos.' : 'A frase é sobre ' + CAND[cand].nome + '.';
  return 'Você é um verificador apartidário. Diga se a frase abaixo confere com os planos de governo oficiais dos candidatos à Presidência do Brasil em ' + ELEICAO.ano + ': ' + DESCRICAO + '.\n\n' +
    'Regras:\n' +
    '- Use SOMENTE o material abaixo. Não use memória, opinião ou fatos de fora.\n' +
    '- Trate os dois candidatos exatamente da mesma forma. Não avalie mérito, viabilidade, constitucionalidade nem intenção.\n' +
    '- "classificacao" compara a frase com o PLANO: consta | consta_em_parte (o plano trata do tema, mas com diferença de número, alcance ou condição) | nao_consta (o plano não trata; isso NÃO prova que a frase é falsa) | contraria (o plano diz o oposto) | nao_e_proposta (a frase não é sobre proposta, ex.: fato passado ou ataque pessoal).\n' +
    '- "evidencias": cópia LITERAL do texto de um bloco [PLANO], até 40 palavras, com a página certa. Nada de paráfrase.\n' +
    '- "imprensa": índices dos blocos [WEB] que tratam DESTA frase ou do mesmo assunto, com 1 frase neutra do que dizem. Ignore os que não tratam.\n' +
    '- "checagens": ids dos blocos [CHECAGEM] que tratam da frase.\n' +
    '- Português simples, frases curtas, sem adjetivos valorativos.\n\n' +
    'Frase: """' + frase + '"""\n' + who + '\n\n' +
    '=== TRECHOS DOS PLANOS ===\n' + (blocos.join('\n\n') || '(nenhum trecho encontrado)') + '\n\n' +
    '=== CHECAGENS PUBLICADAS ===\n' + (fcTxt || '(nenhuma)') + '\n\n' +
    '=== BUSCA NA WEB (agências de checagem e imprensa) ===\n' + (webTxt || '(sem resultados)') + '\n\n' +
    'Responda só com JSON:\n' +
    '{"sobre":"' + LISTA_IDS + '|ambos|indefinido","classificacao":"...","explicacao":"2 a 4 frases","evidencias":[{"candidato":"' + LISTA_IDS + '","pagina":0,"trecho":"..."}],"imprensa":[{"indice":0,"resumo":"..."}],"checagens":[0],"limites":"1 frase sobre o que não dá para saber só por este material"}';
}

// Casos em que a IA confundia categorias vizinhas. Vale para qualquer candidato.
const GUIA_ESPECTRO =
  '- Imposto: aumentar imposto de quem ganha ou tem mais (grandes fortunas, heranças, lucros e dividendos, IR progressivo) ou isentar quem ganha pouco é per503 (igualdade). Reduzir imposto de empresas, desonerar a folha ou dar incentivo fiscal a setores é per402. Equilíbrio das contas e corte de gastos é per414.\n' +
  '- Privatizar ou conceder é per401; estatizar ou retomar controle estatal é per413.\n' +
  '- Ampliar SUS, Previdência ou programa social é per504; cortar ou limitar benefício é per505.\n' +
  '- Polícia, penas, presídios e controle de armas é per605.\n' +
  '- Reduzir jornada, ampliar direitos trabalhistas ou apoiar sindicatos é per701; fazer o acordo entre empresa e trabalhador prevalecer sobre a lei é per401.\n';

function promptEspectro(frase, trechos) {
  const cats = dados().categorias.map((c) => c.codigo + ' | ' + c.nome + ' | ' + c.descricao).join('\n');
  const blocos = [];
  for (const k of Object.keys(trechos)) for (const p of trechos[k]) blocos.push('[PLANO ' + k + ' p.' + p.p + ']\n' + janela(p, [frase], 2400));
  const ex = exemplosEspectro(frase).map((x) => '- "' + x.proposta + '" -> ' + x.categoria).join('\n');
  return 'Você classifica frases políticas pelo codebook do Manifesto Project (MARPOR), de forma apartidária.\n' +
    'Regras:\n' +
    '- Escolha UMA categoria da lista, pelo que a MEDIDA faz, não pela justificativa dada. Ex.: "acabar com o programa X" é a categoria de limitação, não a de expansão.\n' +
    GUIA_ESPECTRO +
    (ex ? '- Propostas parecidas já classificadas neste site (siga o mesmo critério):\n' + ex + '\n' : '') +
    '- Diga de quem a frase fala (' + LEGENDA_IDS + '; ou indefinido).\n' +
    '- Compare com os trechos do PLANO do candidato: consta | consta_em_parte | nao_consta | contraria. "nao_consta" não prova que a frase é falsa.\n' +
    '- "evidencias": cópia LITERAL de um bloco [PLANO], até 40 palavras, com a página certa.\n' +
    '- Português simples, sem adjetivos valorativos.\n\n' +
    'Frase: """' + frase + '"""\n\n=== CATEGORIAS ===\n' + cats + '\n\n=== TRECHOS DOS PLANOS ===\n' + (blocos.join('\n\n') || '(nenhum)') + '\n\n' +
    'Responda só com JSON: {"sobre":"' + LISTA_IDS + '|indefinido","categoria":"perXXX","justificativa":"<por que esta categoria, em 1 ou 2 frases>","plano":"consta|consta_em_parte|nao_consta|contraria","explicacao_plano":"<o que o plano diz sobre isso, em 1 ou 2 frases>","evidencias":[{"candidato":"' + LISTA_IDS + '","pagina":0,"trecho":"..."}]}';
}

function promptExtrair(texto) {
  return 'O texto abaixo foi lido (OCR) de um print enviado por um eleitor: post, notícia ou mensagem. Pode ter erros de leitura.\n' +
    'Liste até 3 afirmações verificáveis sobre os candidatos à Presidência do Brasil em ' + ELEICAO.ano + ' (' + LEGENDA_IDS + ') ou sobre suas propostas, ' +
    'cada uma como frase curta, fiel ao texto, citando o nome do candidato. Corrija só erros evidentes de leitura. Não julgue e não acrescente nada. ' +
    'Se não houver afirmação desse tipo, devolva a lista vazia.\n\n' +
    'Texto: """' + texto + '"""\n\nResponda só com JSON: {"afirmacoes":["..."]}';
}

function promptTermosAcervo(pergunta) {
  const docs = acervo().idx.map((d) => d.id + ' = ' + d.titulo).join('; ');
  return 'Você prepara a busca de artigos de lei para responder a pergunta de um cidadão.\n' +
    'Documentos disponíveis: ' + docs + '.\n' +
    'Pergunta: """' + pergunta + '"""\n' +
    'Responda só com JSON: {"consultas":["3 a 6 consultas de 1 a 4 palavras, com os termos que a própria lei usaria (ex.: para jornada, \\"duração do trabalho\\" e \\"horas semanais\\"; para maioridade penal, \\"penalmente inimputáveis\\" e \\"menores de dezoito anos\\")"],"documentos":["ids dos documentos mais prováveis, até 3"],"artigos":[{"doc":"id do documento","artigo":"número do artigo que provavelmente trata do assunto, ex.: 228"}]}\n' +
    'Em "artigos", indique até 4 artigos que você acredita tratar do assunto. Eles só servem para localizar o texto; a resposta virá do texto oficial.';
}

function promptAcervo(pergunta, achados, consultas) {
  // Os dois artigos mais relevantes vão quase inteiros: artigos como o 7º da CF têm dezenas de incisos.
  const blocos = achados.map((x, i) => '[' + x.doc + ' | ' + x.a.n + '] (' + x.a.hier + ')\n' + janela(x.a, consultas, i < 2 ? 4500 : 1200)).join('\n\n');
  return 'Você explica a legislação brasileira a um cidadão, de forma apartidária, usando SOMENTE os artigos abaixo. ' +
    'Eles vêm do texto compilado oficial do Planalto, com a redação em vigor.\n' +
    'Regras:\n' +
    '- Responda em português simples, de 2 a 5 frases curtas. Diga o que a lei estabelece e cite o artigo.\n' +
    '- Não opine, não avalie candidatos nem propostas, não dê orientação jurídica para um caso particular.\n' +
    '- Se os artigos abaixo não respondem a pergunta, diga isso claramente e não complete com memória.\n' +
    '- "citacoes": trechos LITERAIS de até 40 palavras, com "doc" e "artigo" exatamente como no rótulo [doc | artigo].\n\n' +
    'Pergunta: """' + pergunta + '"""\n\n=== ARTIGOS ===\n' + (blocos || '(nenhum artigo encontrado)') + '\n\n' +
    'Responda só com JSON: {"resposta":"...","citacoes":[{"doc":"cf","artigo":"Art. 7º","trecho":"..."}],"limites":"1 frase sobre o que estes artigos não respondem"}';
}

// ---------- validação ----------

function validar(r, trechos, fcs, web) {
  const out = {
    sobre: IDS.concat(['ambos', 'indefinido']).includes(r.sobre) ? r.sobre : 'indefinido',
    classificacao: CLASSES.includes(r.classificacao) ? r.classificacao : 'nao_consta',
    explicacao: String(r.explicacao || '').slice(0, 1200),
    limites: String(r.limites || '').slice(0, 400),
    evidencias: [], imprensa: [], checagens: [], descartadas: 0
  };
  for (const e of Array.isArray(r.evidencias) ? r.evidencias.slice(0, 6) : []) {
    const k = e && IDS.includes(e.candidato) ? e.candidato : null;
    const p = k && dados().planos[k].find((x) => x.p === Number(e.pagina));
    const segs = String((e && e.trecho) || '').split(/\.\.\.|…/).map(loose).filter((s) => s.length > 10);
    if (p && segs.length && segs.every((s) => p.l.includes(s))) out.evidencias.push({ candidato: k, pagina: p.p, trecho: String(e.trecho).slice(0, 400) });
    else out.descartadas++;
  }
  const vistos = new Set();
  for (const x of Array.isArray(r.imprensa) ? r.imprensa : []) {
    const w = web[Number(x && x.indice)];
    if (!w || vistos.has(w.url)) continue;
    vistos.add(w.url);
    out.imprensa.push({ titulo: w.titulo, url: w.url, fonte: w.fonte, resumo: String(x.resumo || '').slice(0, 400) });
  }
  const validos = new Set(fcs.map((x) => x.i));
  out.checagens = (Array.isArray(r.checagens) ? r.checagens : []).map(Number).filter((i) => validos.has(i));
  return out;
}

// ---------- "Pergunte ao site": tudo o que o site tem, em blocos com fonte ----------

const TIPOS_SITE = {
  proposta: 'Proposta do plano', plano: 'Página do plano', checagem: 'Checagem publicada', viabilidade: 'Viabilidade e evidências',
  proposicao: 'Congresso e tribunais', espectro: 'Esquerda ou direita', ideologia: 'Ideologias', levantamento: 'Levantamento de promessas',
  promessa: 'Promessa anterior', eleicao: 'Eleições desde 1891', governo: 'Governos desde 1889', entrega: 'Entrega não prometida', lei: 'Acervo Constitucional'
};
// Quantos blocos de cada tipo vão para a IA (por candidato, nos tipos marcados com *).
const COTA_SITE = { proposta: 3, plano: 2, checagem: 2, viabilidade: 2, espectro: 1, proposicao: 2, ideologia: 2, levantamento: 2, promessa: 4, eleicao: 2, governo: 3, entrega: 3, lei: 3 };
const POR_CANDIDATO = new Set(['proposta', 'plano', 'checagem', 'viabilidade', 'espectro']);

let SITE = null;
function siteIndice() {
  if (SITE) return SITE;
  const ler = (n) => { try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', n), 'utf8')); } catch (e) { return null; } };
  const blocos = [];
  const add = (tipo, titulo, texto, extra) => {
    const t = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    blocos.push(Object.assign({ id: 'S' + blocos.length, tipo, titulo, t, f: fold(titulo + ' ' + t), l: loose(t) }, extra));
  };
  const nome = (k) => (CAND[k] ? CAND[k].nome : k);
  const comp = ler('comparativo.json');
  for (const tm of (comp && comp.temas) || []) {
    add('proposta', 'Em comum e diferença · ' + tm.nome, 'Em comum: ' + (tm.em_comum || '') + ' Principal diferença: ' + (tm.diferenca || ''), { link: '#tema-' + tm.id });
    tm.itens.forEach((it) => {
      if (!it.trecho) return;
      add('proposta', nome(it.candidato) + ' · ' + tm.nome, 'Proposta: ' + it.proposta + ' Em palavras simples: ' + (it.simples || '') + ' Trecho do plano, p. ' + it.pagina + ': "' + it.trecho + '"',
        { link: '#tema-' + tm.id, candidato: it.candidato, abrir: it.candidato + ':' + it.pagina });
    });
  }
  for (const k of IDS) for (const p of dados().planos[k]) {
    if (!p.toc) blocos.push({ id: 'S' + blocos.length, tipo: 'plano', titulo: 'Plano de ' + nome(k) + ', p. ' + p.p, t: p.t, f: p.f, l: p.l, candidato: k, abrir: k + ':' + p.p });
  }
  for (const c of dados().checagens) {
    add('checagem', c.fonte + ' · ' + nome(c.candidato), (c.tipo === 'fala' ? 'Fala do candidato: ' : 'Alegação sobre o candidato: ') + c.alegacao + ' Veredito da agência: ' + c.veredito + '. ' + (c.explicacao || ''),
      { link: '#checagens', url: c.url, candidato: c.candidato });
  }
  const temaNome = Object.fromEntries(((comp && comp.temas) || []).map((tm) => [tm.id, tm.nome]));
  for (const a of ((ler('avaliacao.json') || {}).itens || [])) {
    const v = a.viabilidade || {}, im = a.impactos || {};
    add('viabilidade', nome(a.candidato) + ' · ' + (temaNome[a.tema] || a.tema), 'Proposta: ' + a.proposta + ' O que exige: ' + ((v.instrumento || {}).explicacao || '') + ' Custo: ' + ((v.custo || {}).plano_diz || '') + ' ' + ((v.custo || {}).estimativa_externa || '') +
      ' Estudos: ' + ((v.evidencia || {}).resumo || '') + ' Quem ganha: ' + (im.quem_ganha || '') + ' Quem paga ou perde: ' + (im.quem_paga_ou_perde || ''), { link: '#tema-' + a.tema, candidato: a.candidato });
    for (const p of a.proposicoes || []) add('proposicao', p.numero + ' (' + p.casa + ')', (p.ementa || '') + ' Situação: ' + (p.situacao || '') + ' Autoria: ' + (p.autor || '') + ' Ligada à proposta de ' + nome(a.candidato) + ': ' + a.proposta, { link: '#congresso', url: p.url });
  }
  const esp = ler('espectro.json') || {};
  const catNome = Object.fromEntries((esp.categorias || []).map((c) => [c.codigo, c.nome]));
  for (const x of esp.itens || []) {
    const tm = ((comp && comp.temas) || []).find((t) => t.id === x.tema), it = tm && tm.itens[x.indice];
    if (it) add('espectro', nome(it.candidato) + ' · ' + tm.nome, it.proposta + ' Classificação: ' + x.direcao + ', categoria ' + (catNome[x.categoria] || x.categoria) + ' (Manifesto Project). ' + (x.justificativa || ''), { link: '#espectro', candidato: it.candidato });
  }
  for (const i of ((ler('ideologias.json') || {}).ideologias || [])) {
    add('ideologia', i.nome, (i.definicao || i.resumo || '') + ' Propostas típicas: ' + (i.propostas || []).join('; ') + ' No Brasil: ' + (i.no_brasil || ''), { link: '#ideologias', ideo: i.id });
  }
  for (const r of ((ler('historico.json') || {}).registros || [])) {
    for (const t of r.rastreadores || []) {
      add('levantamento', t.fonte + ' · ' + r.candidato + ' ' + (r.governo || r.eleicao), 'Promessas do plano de ' + r.candidato + ' (' + r.eleicao + '), governo ' + (r.governo || '') + ': cumpridas ' + (t.cumpridas ?? '?') + ', parciais ' + (t.parciais ?? '?') +
        ', não cumpridas ' + (t.nao_cumpridas ?? '?') + ', total ' + (t.total ?? '?') + ' (data ' + (t.data || '') + '). ' + (t.metodo || '') + ' ' + (t.observacao || ''), { link: '#historico', url: t.url });
    }
  }
  const ver = new Map((((ler('verificacao.json') || {}).itens) || []).map((v) => [v.levantamento + '|' + v.indice, v]));
  for (const lv of ((ler('promessas.json') || {}).levantamentos || [])) {
    (lv.itens || []).forEach((it, i) => {
      const v = ver.get(lv.id + '|' + i);
      add('promessa', lv.fonte + ' · governo ' + lv.governo, 'Promessa: ' + it.promessa + ' Status dado por ' + lv.fonte + ': ' + it.status_original + '. ' + (it.avaliacao || '') +
        (v ? ' Verificação em fonte oficial: ' + v.status.replace(/_/g, ' ') + '. ' + (v.justificativa || '') : ''), { link: '#historico', url: it.url || lv.url });
    });
  }
  const ideo = new Map((((ler('eleicoes_ideologia.json') || {}).candidatos) || []).map((c) => [c.ano + '|' + fold(c.nome), c]));
  const posicao = (ano, nomeC) => { const i = ideo.get(ano + '|' + fold(nomeC)); return i && i.eixo !== 'sem_classificacao' ? ', posição ' + i.eixo + (i.familia ? ' (' + i.familia + ')' : '') : ''; };
  for (const e of ((ler('eleicoes.json') || {}).eleicoes || [])) {
    add('eleicao', 'Eleição de ' + e.ano, e.tipo + '. ' + e.candidatos.map((c) => c.nome + ' (' + (c.partido || '') + ')' + posicao(e.ano, c.nome) + (c.pct_1t != null ? ', ' + c.pct_1t + '% no 1º turno' : '') + (c.pct_2t != null ? ', ' + c.pct_2t + '% no 2º turno' : '') + (c.eleito ? ', eleito' : '')).join('; ') + '. ' + (e.observacao || ''), { link: '#eleicoes' });
  }
  for (const g of ((ler('entregas.json') || {}).governos || [])) {
    for (const it of g.itens || []) {
      add('entrega', g.nome + ' · ' + it.titulo, it.o_que_e + ' Não estava no plano de governo. Alcance: ' + ((it.alcance || {}).texto || '') + ' Avaliações (' + it.balanco + '): ' + (it.resumo_avaliacoes || '') + ' Quem ganha: ' + (it.quem_ganha || '') + ' Quem paga ou perde: ' + (it.quem_paga_ou_perde || ''), { link: '#historico' });
    }
  }
  // Resumo para perguntas de conjunto ("quais presidentes eram de direita?").
  const eleitos = [];
  for (const e of ((ler('eleicoes.json') || {}).eleicoes || [])) for (const c of e.candidatos) if (c.eleito) eleitos.push(e.ano + ': ' + c.nome + ' (' + (c.partido || 'sem partido') + ')' + (posicao(e.ano, c.nome) || ', sem classificação'));
  add('eleicao', 'Presidentes eleitos e posição ideológica', 'Todos os presidentes eleitos, com a posição no eixo esquerda–direita: ' + eleitos.join('; ') + '.', { link: '#eleicoes' });
  for (const g of ((ler('governos.json') || {}).governos || [])) {
    add('governo', g.presidente + ' (' + String(g.inicio).slice(0, 4) + '–' + (g.fim ? String(g.fim).slice(0, 4) : 'hoje') + ')',
      (g.contexto || '') + ' Chegada ao poder: ' + (g.chegada || '') + '. Partido: ' + (g.partido || 'sem partido') + '. Avanços registrados: ' + (g.avancos || []).map((a) => a.texto).join(' ') +
      ' Críticas registradas: ' + (g.criticas || []).map((a) => a.texto + (a.autor_da_critica ? ' (' + a.autor_da_critica + ')' : '')).join(' '), { link: '#eleicoes' });
  }
  SITE = blocos;
  return SITE;
}

function blocosRelevantes(consultas, sobre) {
  const tss = consultas.map(termos).filter((ts) => ts.length);
  const porTipo = {};
  for (const b of siteIndice()) {
    let s = 0;
    for (const ts of tss) s += pontuar({ f: b.f, toc: false }, ts);
    if (s > 0) (porTipo[b.tipo] = porTipo[b.tipo] || []).push({ b, s });
  }
  const out = [];
  for (const tipo of Object.keys(COTA_SITE)) {
    const lista = (porTipo[tipo] || []).sort((x, y) => y.s - x.s);
    if (POR_CANDIDATO.has(tipo)) {
      // Mesmo número de blocos para cada candidato, a menos que a pergunta seja sobre um só.
      for (const k of IDS) if (sobre === 'ambos' || sobre === k) out.push(...lista.filter((x) => x.b.candidato === k).slice(0, COTA_SITE[tipo]));
    } else out.push(...lista.slice(0, COTA_SITE[tipo]));
  }
  // Leis: a mesma busca do Acervo Constitucional.
  try {
    for (const x of artigosRelevantes(consultas, [], COTA_SITE.lei)) {
      const d = acervo().docs[x.doc];
      out.push({ s: x.s, b: { id: 'L' + x.doc + '|' + x.a.n, tipo: 'lei', titulo: d.titulo + ' · ' + x.a.n, t: x.a.t, f: x.a.f, l: x.a.l, link: '#acervo', url: d.url } });
    }
  } catch (e) { /* sem acervo */ }
  return out.map((x) => x.b);
}

function promptSite(pergunta, blocos, consultas) {
  const txt = blocos.map((b) => '[' + b.id + '] ' + TIPOS_SITE[b.tipo] + ' · ' + b.titulo + '\n' + janela({ t: b.t, f: fold(b.t) }, consultas, b.tipo === 'plano' || b.tipo === 'lei' ? 1500 : 900)).join('\n\n');
  return 'Você responde perguntas de eleitores sobre o conteúdo do site Lado a Lado ' + ELEICAO.ano + ', que compara de forma apartidária os planos de governo de ' + DESCRICAO + '. ' +
    'O site também reúne checagens de agências, viabilidade das propostas, proposições no Congresso, classificação esquerda–direita, ideologias, promessas de governos anteriores com verificação em fontes oficiais, eleições desde 1891 e a Constituição e leis.\n' +
    'Regras:\n' +
    '- Use SOMENTE os blocos abaixo. Não use memória nem fatos de fora. Se os blocos não respondem, diga isso.\n' +
    '- Depois de cada afirmação, cite o bloco entre colchetes, ex.: [S12]. Use só ids que aparecem abaixo.\n' +
    '- Trate os candidatos exatamente da mesma forma: se a pergunta envolve mais de um, responda sobre cada um com extensão parecida.\n' +
    '- Não opine, não recomende voto, não avalie se proposta é boa ou ruim. Quando houver estudos ou avaliações nos blocos, relate o que eles dizem, atribuindo a quem disse.\n' +
    '- Português simples, de 3 a 7 frases curtas.\n' +
    '- "citacoes": até 4 trechos LITERAIS (até 30 palavras) dos blocos usados, com o id.\n\n' +
    'Pergunta: """' + pergunta + '"""\n\n=== BLOCOS ===\n' + (txt || '(nenhum bloco encontrado)') + '\n\n' +
    'Responda só com JSON: {"resposta":"texto com [S..] após cada afirmação","citacoes":[{"id":"S0","trecho":"..."}]}';
}

async function responderSite(req, corpo, envia) {
  const pergunta = String(corpo.pergunta || '').replace(/\s+/g, ' ').trim();
  if (pergunta.length < 5 || pergunta.length > 500) return envia(400, { erro: 'Escreva uma pergunta entre 5 e 500 caracteres.' });
  const chave = 'site|' + fold(pergunta);
  const ja = lembrada(chave);
  if (ja) return envia(200, Object.assign({}, ja, { cache: true }));
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  if (!dentroDoLimite(ip)) return envia(429, { erro: 'Muitas consultas seguidas. Tente de novo em alguns minutos.' });

  const prazo = Date.now() + 52000, trilha = [];
  let consultas = [pergunta], sobre = quemNaFrase(' ' + fold(pergunta) + ' ') || 'ambos';
  const t = await perguntar(promptTermos(pergunta), 500, Math.min(prazo, Date.now() + 12000), trilha);
  if (t && t.json) {
    consultas = consultas.concat((Array.isArray(t.json.consultas_plano) ? t.json.consultas_plano : []).map(String).slice(0, 5));
    if (sobre === 'ambos' && IDS.includes(t.json.sobre)) sobre = t.json.sobre;
  }
  const blocos = blocosRelevantes(consultas, sobre);
  const porId = new Map(blocos.map((b) => [b.id, b]));
  const r = await perguntar(promptSite(pergunta, blocos, consultas), 1600, prazo, trilha, (j) => String(j.resposta || '').length > 20);
  if (!r) {
    console.log('[site] sem resposta: ' + trilha.join(' ; '));
    return envia(503, { erro: 'A IA não respondeu agora. Tente de novo em alguns minutos.', detalhe: resumoTrilha(trilha) });
  }
  // Só ficam as marcações de blocos que existem; a ordem de aparição define a numeração.
  const usados = [];
  const resposta = String(r.json.resposta || '').slice(0, 2500).replace(/\[([SL][^\]\s]{0,80})\]/g, (m, id) => {
    if (!porId.has(id)) return '';
    if (usados.indexOf(id) < 0) usados.push(id);
    return '[' + id + ']';
  }).replace(/\s+([.,;])/g, '$1');
  let descartadas = 0;
  const citacoes = [];
  for (const c of Array.isArray(r.json.citacoes) ? r.json.citacoes.slice(0, 6) : []) {
    const b = porId.get(String(c && c.id));
    const segs = String((c && c.trecho) || '').split(/\.\.\.|…/).map(loose).filter((s) => s.length > 10);
    if (b && segs.length && segs.every((s) => b.l.includes(s))) {
      citacoes.push({ id: b.id, trecho: String(c.trecho).slice(0, 300) });
      if (usados.indexOf(b.id) < 0) usados.push(b.id);
    } else descartadas++;
  }
  const fonte = (b) => ({ id: b.id, tipo: b.tipo, rotulo: TIPOS_SITE[b.tipo], titulo: b.titulo, link: b.link || '', url: b.url || '', abrir: b.abrir || '', ideo: b.ideo || '' });
  const out = {
    modo: 'site', resposta, citacoes, descartadas,
    fontes: usados.map((id) => fonte(porId.get(id))),
    consultados: blocos.filter((b) => usados.indexOf(b.id) < 0).slice(0, 12).map(fonte),
    modelo: r.modelo
  };
  lembrar(chave, out);
  return envia(200, out);
}

// Só provedor, modelo e tipo da falha: mostra no navegador por que a IA não respondeu.
function resumoTrilha(trilha) {
  return trilha.slice(-12).map((s) => String(s).replace(/(gsk_|sk-|AIza)[\w-]{6,}/g, '***').slice(0, 100));
}

// "Art. 7º", "art 7", "artigo 7o" -> "art7"
const normArt = (s) => fold(String(s)).replace(/artigo/g, 'art').replace(/(\d)\s*[ºo°]/g, '$1').replace(/[^a-z0-9-]/g, '');

async function responderAcervo(req, corpo, envia) {
  const pergunta = String(corpo.pergunta || '').replace(/\s+/g, ' ').trim();
  if (pergunta.length < 5 || pergunta.length > 500) return envia(400, { erro: 'Escreva uma pergunta entre 5 e 500 caracteres.' });
  try { acervo(); } catch (e) { return envia(503, { erro: 'O acervo não está disponível neste servidor.' }); }
  const A = acervo();
  const doc = A.docs[corpo.doc] ? corpo.doc : '';
  const chave = 'acervo|' + doc + '|' + fold(pergunta);
  const ja = lembrada(chave);
  if (ja) return envia(200, Object.assign({}, ja, { cache: true }));
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  if (!dentroDoLimite(ip)) return envia(429, { erro: 'Muitas consultas seguidas. Tente de novo em alguns minutos.' });

  const prazo = Date.now() + 52000, trilha = [];
  const fp = ' ' + fold(pergunta).replace(/[^a-z0-9]+/g, ' ') + ' ';
  let consultas = [pergunta].concat(Object.keys(AC_SINONIMOS).filter((k) => fp.includes(' ' + k + ' ')).map((k) => AC_SINONIMOS[k]));
  let docIds = doc ? [doc] : [];
  let alvos = [];
  const t = await perguntar(promptTermosAcervo(pergunta), 500, Math.min(prazo, Date.now() + 12000), trilha);
  if (t && t.json) {
    consultas = consultas.concat((Array.isArray(t.json.consultas) ? t.json.consultas : []).map(String).slice(0, 6));
    if (!doc && Array.isArray(t.json.documentos)) docIds = t.json.documentos.map(String).filter((d) => A.docs[d]).slice(0, 3);
    alvos = (Array.isArray(t.json.artigos) ? t.json.artigos : []).slice(0, 4)
      .filter((x) => x && A.docs[x.doc] && (!doc || x.doc === doc))
      .map((x) => x.doc + '|' + normArt('Art. ' + String(x.artigo).replace(/^\s*art(?:igo)?\.?\s*/i, '')));
    for (const a of alvos) { const d = a.split('|')[0]; if (!doc && docIds.indexOf(d) < 0) docIds.push(d); }
  }
  const achados = artigosRelevantes(consultas, docIds, 8, alvos);
  if (!doc && docIds.length) {
    // Completa com a busca em todos os documentos, para não depender só da escolha da IA.
    const vistos = new Set(achados.map((x) => x.doc + '|' + x.a.n));
    for (const x of artigosRelevantes(consultas, [], 8, alvos)) {
      if (achados.length >= 10) break;
      if (!vistos.has(x.doc + '|' + x.a.n)) achados.push(x);
    }
  }
  const artigos = achados.map((x) => ({ doc: x.doc, titulo: A.docs[x.doc].titulo, url: A.docs[x.doc].url, n: x.a.n, hier: x.a.hier, t: x.a.t.slice(0, 1500) }));
  const r = await perguntar(promptAcervo(pergunta, achados, consultas), 1500, prazo, trilha, (j) => String(j.resposta || '').length > 20);
  if (!r) {
    console.log('[acervo] sem resposta: ' + trilha.join(' ; '));
    return envia(503, { erro: 'A IA não respondeu agora. Os artigos encontrados pela busca estão abaixo.', detalhe: resumoTrilha(trilha), artigos });
  }
  const citacoes = [];
  let descartadas = 0;
  for (const c of Array.isArray(r.json.citacoes) ? r.json.citacoes.slice(0, 6) : []) {
    const x = achados.find((y) => y.doc === String(c && c.doc) && normArt(y.a.n) === normArt(c && c.artigo));
    const segs = String((c && c.trecho) || '').split(/\.\.\.|…/).map(loose).filter((s) => s.length > 10);
    if (x && segs.length && segs.every((s) => x.a.l.includes(s))) {
      citacoes.push({ doc: x.doc, titulo: A.docs[x.doc].titulo, artigo: x.a.n, trecho: String(c.trecho).slice(0, 400), url: A.docs[x.doc].url });
    } else descartadas++;
  }
  const out = {
    modo: 'acervo', busca: { consultas: consultas.slice(1), alvos, etapa: t ? t.modelo : 'sem IA: ' + resumoTrilha(trilha).join(' ; ') }, resposta: String(r.json.resposta || '').slice(0, 1500), citacoes, descartadas,
    limites: String(r.json.limites || '').slice(0, 400), artigos, modelo: r.modelo
  };
  lembrar(chave, out);
  return envia(200, out);
}

// ---------- handler ----------

module.exports = async (req, res) => {
  const envia = (st, obj) => {
    res.statusCode = st;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'GET') {
    // ?modelos=1 lista os modelos que o Groq oferece hoje (lista pública, sem chave na resposta).
    if (/[?&]modelos=1/.test(String(req.url || '')) && process.env.GROQ_API_KEY) {
      const r = await comTempo('https://api.groq.com/openai/v1/models', { headers: { authorization: 'Bearer ' + process.env.GROQ_API_KEY } }, 10000);
      return envia(200, { groq: ((r.data && r.data.data) || []).map((m) => m.id).sort(), usados: MODELOS.groq() });
    }
    return envia(200, {
      ok: true, versao: VERSAO, ia: configurados().length > 0, busca: !!process.env.TAVILY_API_KEY,
      imagem: ORDEM_VISAO.some((p) => !!process.env[CHAVE[p]]), audio: !!process.env.GROQ_API_KEY,
      acervo: fs.existsSync(path.join(process.cwd(), 'data', 'acervo.json'))
    });
  }
  if (req.method !== 'POST') return envia(405, { erro: 'Use POST.' });
  if (!configurados().length) return envia(503, { erro: 'A análise automática não está configurada neste site.' });

  let corpo = req.body;
  if (typeof corpo === 'string') { try { corpo = JSON.parse(corpo); } catch (e) { corpo = {}; } }

  // Print (imagem) e voz (áudio): só transformam em texto. A checagem vem depois,
  // com o texto que a pessoa conferiu.
  if (corpo && (corpo.modo === 'imagem' || corpo.modo === 'audio')) {
    const ipM = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
    if (!dentroDoLimite(ipM)) return envia(429, { erro: 'Muitas consultas seguidas. Tente de novo em alguns minutos.' });
    const trilhaM = [];
    if (corpo.modo === 'imagem') {
      const url = String(corpo.imagem || '');
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url) || url.length > 4500000) {
        return envia(400, { erro: 'Envie uma imagem JPG, PNG ou WEBP de até 3 MB.' });
      }
      const r = await lerImagem(url, Date.now() + 40000, trilhaM);
      if (!r) {
        console.log('[imagem] sem resposta: ' + trilhaM.join(' ; '));
        return envia(503, { erro: 'Não foi possível ler a imagem agora. Tente de novo ou digite a frase.', detalhe: resumoTrilha(trilhaM) });
      }
      const afirmacoes = (Array.isArray(r.json.afirmacoes) ? r.json.afirmacoes : []).map((x) => String(x).replace(/\s+/g, ' ').trim().slice(0, 400)).filter((x) => x.length >= 8).slice(0, 3);
      return envia(200, { modo: 'imagem', texto: String(r.json.texto || '').slice(0, 1500), afirmacoes, modelo: r.modelo });
    }
    const b64 = String(corpo.audio || '');
    const mime = String(corpo.mime || 'audio/webm').split(';')[0];
    if (!/^[A-Za-z0-9+/=]+$/.test(b64) || b64.length > 3500000 || !/^audio\/(webm|ogg|mp4|mpeg|wav|x-m4a|aac)$/.test(mime)) {
      return envia(400, { erro: 'Envie um áudio de até 1 minuto.' });
    }
    if (!process.env.GROQ_API_KEY) return envia(503, { erro: 'A transcrição de voz não está configurada neste site.' });
    const t = await transcrever(b64, mime, trilhaM);
    if (!t) {
      console.log('[audio] sem resposta: ' + trilhaM.join(' ; '));
      return envia(503, { erro: 'Não foi possível entender o áudio agora. Tente de novo ou digite a frase.', detalhe: resumoTrilha(trilhaM) });
    }
    return envia(200, { modo: 'audio', texto: t.slice(0, 600) });
  }

  // Texto lido do print no próprio navegador (OCR): a IA de texto separa as afirmações.
  if (corpo && corpo.modo === 'extrair') {
    const texto = String(corpo.texto || '').replace(/\s+/g, ' ').trim().slice(0, 2500);
    if (texto.length < 8) return envia(400, { erro: 'O print não tem texto legível.' });
    const ipE = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
    if (!dentroDoLimite(ipE)) return envia(429, { erro: 'Muitas consultas seguidas. Tente de novo em alguns minutos.' });
    const trilhaE = [];
    const r = await perguntar(promptExtrair(texto), 500, Date.now() + 40000, trilhaE);
    if (!r) return envia(503, { erro: 'Não foi possível separar as afirmações agora. O texto lido está no campo.', detalhe: resumoTrilha(trilhaE) });
    const afirmacoes = (Array.isArray(r.json.afirmacoes) ? r.json.afirmacoes : []).map((x) => String(x).replace(/\s+/g, ' ').trim().slice(0, 400)).filter((x) => x.length >= 8).slice(0, 3);
    return envia(200, { modo: 'extrair', texto, afirmacoes, modelo: r.modelo });
  }

  if (corpo && corpo.modo === 'acervo') return responderAcervo(req, corpo, envia);
  if (corpo && corpo.modo === 'site') return responderSite(req, corpo, envia);
  const frase = String((corpo && corpo.frase) || '').replace(/\s+/g, ' ').trim();
  const cand = IDS.includes(corpo && corpo.candidato) ? corpo.candidato : 'ambos';
  if (frase.length < 8 || frase.length > 400) return envia(400, { erro: 'Escreva uma frase entre 8 e 400 caracteres.' });

  const modo = corpo && corpo.modo === 'espectro' ? 'espectro' : 'checar';
  const chave = modo + '|' + cand + '|' + fold(frase);
  const ja = lembrada(chave);
  if (ja) return envia(200, Object.assign({}, ja, { cache: true }));

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  if (!dentroDoLimite(ip)) return envia(429, { erro: 'Muitas análises seguidas. Tente de novo em alguns minutos.' });

  const prazo = Date.now() + 55000;
  const trilha = [];

  if (modo === 'espectro') {
    const f = ' ' + fold(frase) + ' ';
    const quem = quemNaFrase(f);
    const ks = quem ? [quem] : IDS;
    const trechos = {};
    for (const k of ks) trechos[k] = paginasRelevantes(k, [frase], quem ? 4 : 2);
    const r = await perguntar(promptEspectro(frase, trechos), 1500, prazo, trilha,
      (j) => dados().categorias.some((c) => c.codigo === j.categoria) && String(j.justificativa || '').length > 25);
    if (!r) {
      console.log('[espectro] sem resposta: ' + trilha.join(' ; '));
      return envia(503, { erro: 'Os serviços de IA não responderam agora. Tente de novo em alguns minutos.', detalhe: resumoTrilha(trilha) });
    }
    const j = r.json || {};
    const cat = dados().categorias.find((c) => c.codigo === j.categoria);
    if (!cat) return envia(502, { erro: 'A IA não devolveu uma categoria válida. Tente reescrever a frase.' });
    const v = validar({ evidencias: j.evidencias }, trechos, [], []);
    const out = {
      modo, sobre: IDS.includes(j.sobre) ? j.sobre : (quem || 'indefinido'),
      categoria: cat.codigo, justificativa: String(j.justificativa || '').slice(0, 600),
      plano: ['consta', 'consta_em_parte', 'nao_consta', 'contraria'].includes(j.plano) ? j.plano : 'nao_consta',
      explicacao_plano: String(j.explicacao_plano || '').slice(0, 600),
      evidencias: v.evidencias, descartadas: v.descartadas, modelo: r.modelo
    };
    lembrar(chave, out);
    return envia(200, out);
  }

  // 1. termos de busca
  let consultas = [frase], consultaWeb = frase, sobre = cand;
  const t = await perguntar(promptTermos(frase), 400, Math.min(prazo, Date.now() + 15000), trilha);
  if (t && t.json) {
    const cp = Array.isArray(t.json.consultas_plano) ? t.json.consultas_plano.map(String).slice(0, 5) : [];
    consultas = [frase].concat(cp);
    if (t.json.consulta_web) consultaWeb = String(t.json.consulta_web);
    if (cand === 'ambos' && IDS.includes(t.json.sobre)) sobre = t.json.sobre;
  }

  // 2 e 3. planos, checagens e web (a web corre em paralelo)
  const webP = pesquisarWeb(consultaWeb + ' eleição ' + ELEICAO.ano, 12000);
  const ks = sobre === 'ambos' ? IDS : [sobre];
  const trechos = {};
  for (const k of ks) trechos[k] = paginasRelevantes(k, consultas, ks.length === 1 ? 5 : ks.length === 2 ? 3 : 2);
  const fcs = checagensRelevantes(consultas, cand);
  const web = (await webP).resultados || [];

  // 4. resposta
  const r = await perguntar(promptResposta(frase, cand, trechos, fcs, web, consultas), 1800, prazo, trilha,
    (j) => CLASSES.includes(j.classificacao) && String(j.explicacao || '').length > 20);
  if (!r) {
    console.log('[checar] sem resposta: ' + trilha.join(' ; '));
    return envia(503, { erro: 'Os serviços de IA não responderam agora. Tente de novo em alguns minutos.', detalhe: resumoTrilha(trilha) });
  }
  if (trilha.length) console.log('[checar] ok via ' + r.modelo + ' apos: ' + trilha.join(' ; '));

  // 5. validação
  const out = validar(r.json, trechos, fcs, web);
  out.checagens = out.checagens.map((i) => Object.assign({ id: i }, dados().checagens[i]));
  out.busca_web = !!process.env.TAVILY_API_KEY;
  out.modelo = r.modelo;
  lembrar(chave, out);
  return envia(200, out);
};
