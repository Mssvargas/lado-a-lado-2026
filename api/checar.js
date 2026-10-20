// Checagem de uma frase sobre os candidatos contra os planos de governo
// oficiais, as checagens reunidas no site e uma busca ao vivo em agências de
// checagem e veículos jornalísticos.
//
// GET  /api/checar  -> { ok, ia, busca }  (diz o que está configurado; não gasta cota)
// POST /api/checar  { frase, candidato: "ambos"|<id de data/eleicao.json> }
// POST /api/checar  { modo: "espectro", frase }  -> categoria do Manifesto Project + o que o plano diz
// POST /api/checar  { modo: "imagem", imagem: "data:image/...;base64,..." }  -> texto e afirmações do print
// POST /api/checar  { modo: "audio", audio: "<base64>", mime }  -> transcrição da pergunta (Whisper no Groq)
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

const VERSAO = '2026-10-20b';

function fila(env, padrao) {
  const extra = (process.env[env] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  extra.concat(padrao).forEach((m) => { if (out.indexOf(m) < 0) out.push(m); });
  return out;
}

const MODELOS = {
  groq: () => fila('GROQ_MODEL', ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b']),
  cerebras: () => fila('CEREBRAS_MODEL', ['gpt-oss-120b', 'llama-3.3-70b', 'qwen-3-235b-a22b-instruct-2507']),
  openrouter: () => fila('OPENROUTER_MODEL', ['openrouter/free', 'meta-llama/llama-3.3-70b-instruct:free', 'google/gemma-3-27b-it:free']),
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
  CACHE = { planos, checagens: ler('checagens.json').checagens, categorias: esp.categorias || [] };
  return CACHE;
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
  'seu sua seus suas ele ela eles isso esse essa este esta ja já nao não sim tambem também todo toda todos todas ter tem acabar anos verdade mentira falso').split(' ').map(fold));

function quemNaFrase(f) {
  for (const c of ELEICAO.candidatos) {
    if ((c.apelidos || [c.nome]).some((a) => new RegExp('\\b' + fold(a).replace(/[^a-z0-9 ]/g, '') + '\\b').test(f))) return c.id;
  }
  return null;
}

function termos(q) {
  const out = [];
  for (const w of fold(q).split(/[^a-z0-9%]+/)) {
    if (w.length < 3 || STOP.has(w)) continue;
    const stem = w.length > 6 ? w.slice(0, w.length - 2) : w;
    if (out.indexOf(stem) < 0) out.push(stem);
  }
  return out;
}

function pontuar(p, ts) {
  let s = 0, hit = 0;
  for (const t of ts) {
    let i = p.f.indexOf(t), n = 0;
    while (i !== -1 && n < 8) { n++; i = p.f.indexOf(t, i + t.length); }
    if (n) { hit++; s += 3 + n; }
  }
  return hit ? s * hit * (p.toc ? 0.2 : 1) : 0;
}

// Junta as páginas mais relevantes de várias consultas, sem repetir página.
// Trecho da página em volta das palavras buscadas. A página inteira pode passar do
// tamanho que cabe no pedido, e cortar só o começo perdia o trecho que importava.
function janela(p, consultas, max) {
  if (p.t.length <= max) return p.t;
  const ts = [...new Set(consultas.flatMap(termos))];
  const hits = [];
  for (const t of ts) {
    let i = p.f.indexOf(t);
    while (i !== -1) { hits.push(i); i = p.f.indexOf(t, i + t.length); }
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
  if (/^gemini-3\.(5|6)/.test(modelo)) gc.thinkingLevel = 'minimal';
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

// Percorre provedores e modelos até um responder com JSON válido.
async function perguntar(prompt, maxTokens, prazo, trilha) {
  for (const prov of configurados()) {
    for (const modelo of MODELOS[prov]()) {
      const sobra = prazo - Date.now();
      if (sobra < 4000) return null;
      const r = prov === 'gemini'
        ? await chamarGemini(prompt, modelo, maxTokens, Math.min(25000, sobra - 1000))
        : await chamarOpenAI(prov, prompt, modelo, maxTokens, Math.min(25000, sobra - 1000));
      if (!r.ok) { trilha.push(prov + ':' + modelo + ': ' + String(r.msg).slice(0, 120)); continue; }
      const json = extrairJSON(r.texto);
      if (json) return { json, modelo: prov + ':' + modelo };
      trilha.push(prov + ':' + modelo + ': JSON invalido');
    }
  }
  return null;
}

// ---------- imagem (print) e áudio ----------

const ORDEM_VISAO = ['groq', 'openrouter', 'gemini'];
const MODELOS_VISAO = {
  groq: () => fila('GROQ_MODEL_VISAO', ['meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3.6-27b']),
  openrouter: () => fila('OPENROUTER_MODEL_VISAO', ['openrouter/free', 'google/gemma-3-27b-it:free']),
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
  const [, mime, b64] = /^data:(image\/[a-z]+);base64,(.*)$/.exec(dataUrl) || [];
  for (const prov of ORDEM_VISAO) {
    if (!process.env[CHAVE[prov]]) continue;
    for (const modelo of MODELOS_VISAO[prov]()) {
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
    const r = await comTempo('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { authorization: 'Bearer ' + process.env.GROQ_API_KEY }, body: form
    }, 30000);
    const texto = r.http && r.data && typeof r.data.text === 'string' ? r.data.text.trim() : '';
    if (texto) return texto;
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

function promptEspectro(frase, trechos) {
  const cats = dados().categorias.map((c) => c.codigo + ' | ' + c.nome + ' | ' + c.descricao).join('\n');
  const blocos = [];
  for (const k of Object.keys(trechos)) for (const p of trechos[k]) blocos.push('[PLANO ' + k + ' p.' + p.p + ']\n' + janela(p, [frase], 2400));
  return 'Você classifica frases políticas pelo codebook do Manifesto Project (MARPOR), de forma apartidária.\n' +
    'Regras:\n' +
    '- Escolha UMA categoria da lista, pelo que a MEDIDA faz, não pela justificativa dada. Ex.: "acabar com o programa X" é a categoria de limitação, não a de expansão.\n' +
    '- Diga de quem a frase fala (' + LEGENDA_IDS + '; ou indefinido).\n' +
    '- Compare com os trechos do PLANO do candidato: consta | consta_em_parte | nao_consta | contraria. "nao_consta" não prova que a frase é falsa.\n' +
    '- "evidencias": cópia LITERAL de um bloco [PLANO], até 40 palavras, com a página certa.\n' +
    '- Português simples, sem adjetivos valorativos.\n\n' +
    'Frase: """' + frase + '"""\n\n=== CATEGORIAS ===\n' + cats + '\n\n=== TRECHOS DOS PLANOS ===\n' + (blocos.join('\n\n') || '(nenhum)') + '\n\n' +
    'Responda só com JSON: {"sobre":"' + LISTA_IDS + '|indefinido","categoria":"perXXX","justificativa":"1 a 2 frases","plano":"consta|consta_em_parte|nao_consta|contraria","explicacao_plano":"1 a 2 frases","evidencias":[{"candidato":"' + LISTA_IDS + '","pagina":0,"trecho":"..."}]}';
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

// ---------- handler ----------

module.exports = async (req, res) => {
  const envia = (st, obj) => {
    res.statusCode = st;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'GET') {
    return envia(200, {
      ok: true, versao: VERSAO, ia: configurados().length > 0, busca: !!process.env.TAVILY_API_KEY,
      imagem: ORDEM_VISAO.some((p) => !!process.env[CHAVE[p]]), audio: !!process.env.GROQ_API_KEY
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
      const r = await lerImagem(url, Date.now() + 50000, trilhaM);
      if (!r) {
        console.log('[imagem] sem resposta: ' + trilhaM.join(' ; '));
        return envia(503, { erro: 'Não foi possível ler a imagem agora. Tente de novo ou digite a frase.' });
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
      return envia(503, { erro: 'Não foi possível entender o áudio agora. Tente de novo ou digite a frase.' });
    }
    return envia(200, { modo: 'audio', texto: t.slice(0, 600) });
  }
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
    const r = await perguntar(promptEspectro(frase, trechos), 900, prazo, trilha);
    if (!r) {
      console.log('[espectro] sem resposta: ' + trilha.join(' ; '));
      return envia(503, { erro: 'Os serviços de IA não responderam agora. Tente de novo em alguns minutos.' });
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
  const r = await perguntar(promptResposta(frase, cand, trechos, fcs, web, consultas), 1800, prazo, trilha);
  if (!r) {
    console.log('[checar] sem resposta: ' + trilha.join(' ; '));
    return envia(503, { erro: 'Os serviços de IA não responderam agora. Tente de novo em alguns minutos.' });
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
