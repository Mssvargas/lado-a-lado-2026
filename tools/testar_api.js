// Teste local da API sem gastar cota: a IA é simulada, o resto (busca, validação) é real.
// Uso (na raiz do repositório): node tools/testar_api.js
process.env.GROQ_API_KEY = "teste";
const handler = require("../api/checar.js");

let resposta = {};
// Busca na web simulada: só responde quando o teste liga TAVILY_API_KEY.
let tavily = [];
const PAGINAS_WEB = [
  { title: "Checagem: candidato não disse isso", url: "https://www.aosfatos.org/noticias/checagem-teste/", content: "A declaração atribuída ao candidato não aparece em nenhum discurso registrado." },
  { title: "Reportagem sobre o tema", url: "https://g1.globo.com/politica/eleicoes/2026/noticia/teste.ghtml", content: "Reportagem com dados do IBGE sobre o tema da pergunta." }
];
global.fetch = async (url, op) => {
  const body = typeof op.body === "string" ? JSON.parse(op.body) : {};
  if (String(url).includes("tavily")) { tavily.push(body); return { ok: true, status: 200, json: async () => ({ results: PAGINAS_WEB }) }; }
  const prompt = body.messages?.[0]?.content || "";
  const out = typeof resposta === "function" ? resposta(prompt) : resposta;
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(out) } }] }) };
};

function chamar(corpo) {
  return new Promise(res => {
    const r = { statusCode: 0, setHeader() {}, end(s) { res({ status: this.statusCode, j: JSON.parse(s) }); } };
    handler({ method: corpo ? "POST" : "GET", headers: { "x-forwarded-for": String(Math.random()) }, body: corpo }, r);
  });
}

let falhas = 0;
const confere = (nome, ok, extra) => { console.log((ok ? "ok    " : "FALHA ") + nome + (extra ? " | " + extra : "")); if (!ok) falhas++; };

(async () => {
  const g = await chamar(null);
  confere("GET informa acervo", g.j.acervo === true);

  // Acervo: a busca acha o art. 7º da CF; citação literal passa, inventada é descartada.
  let promptAc = "";
  resposta = p => p.includes("prepara a busca de artigos")
    ? { consultas: ["duração do trabalho", "horas semanais"], documentos: ["cf"] }
    : (promptAc = p, { resposta: "A Constituição fixa a jornada em 8 horas por dia e 40 por semana.", citacoes: [
        { doc: "cf", artigo: "Art. 7", trecho: "duração do trabalho normal não superior a 8 (oito) horas diárias e 40 (quarenta) horas semanais" },
        { doc: "cf", artigo: "Art. 7º", trecho: "jornada de 36 horas para todos os trabalhadores do país sem exceção" }], limites: "" });
  const a = await chamar({ modo: "acervo", pergunta: "Qual a jornada máxima de trabalho por semana?" });
  confere("acervo responde 200", a.status === 200, a.j.erro);
  confere("acervo acha o art. 7º da CF", (a.j.artigos || []).some(x => x.doc === "cf" && x.n === "Art. 7º"), (a.j.artigos || []).slice(0, 4).map(x => x.doc + " " + x.n).join(", "));
  confere("citação literal aceita", a.j.citacoes?.length === 1 && a.j.citacoes[0].artigo === "Art. 7º");
  confere("citação inventada descartada", a.j.descartadas === 1);
  confere("a IA recebe o inciso XIII do art. 7º", promptAc.includes("40 (quarenta) horas semanais"));

  // Referência direta ao número do artigo.
  resposta = p => p.includes("prepara a busca") ? { consultas: [], documentos: ["cf"] } : { resposta: "x", citacoes: [] };
  const b = await chamar({ modo: "acervo", pergunta: "O que diz o artigo 5 da Constituição?" });
  confere("\"artigo 5\" traz o Art. 5º", b.j.artigos?.[0]?.n === "Art. 5º", b.j.artigos?.[0]?.n);

  // Artigo apontado pela IA na etapa de busca entra na lista, mesmo sem palavra em comum.
  resposta = p => p.includes("prepara a busca") ? { consultas: ["idade adulto"], documentos: [], artigos: [{ doc: "cf", artigo: "Art. 228" }] } : { resposta: "São penalmente inimputáveis os menores de dezoito anos.", citacoes: [] };
  const c = await chamar({ modo: "acervo", pergunta: "A partir de que idade a pessoa responde criminalmente como adulto?" });
  confere("artigo apontado pela IA é lido", (c.j.artigos || []).some(x => x.doc === "cf" && x.n === "Art. 228"), (c.j.artigos || []).slice(0, 3).map(x => x.doc + " " + x.n).join(", "));

  // Pergunte ao site: busca em todo o conteúdo, mesmo número de blocos por candidato, ids inventados somem.
  let promptSiteTxt = "";
  resposta = p => {
    if (p.includes("Você prepara buscas")) return { sobre: "ambos", consultas_plano: ["escala 6x1", "jornada"], consulta_web: "x" };
    promptSiteTxt = p;
    const m = /\[(S\d+)\] [^\n]*\n…?([^\n]{0,80})/.exec(p);
    return { resposta: `Resposta de teste [${m[1]}] com fonte inventada [S99999].`, citacoes: [{ id: m[1], trecho: m[2].split(" ").slice(0, 8).join(" ") }] };
  };
  const st = await chamar({ modo: "site", pergunta: "O que os candidatos propõem sobre a escala 6x1?" });
  confere("site responde 200", st.status === 200, st.j.erro);
  confere("site cita fonte válida e apaga a inventada", st.j.fontes?.length >= 1 && !st.j.resposta.includes("S99999"), st.j.resposta);
  confere("citação literal do site aceita", st.j.citacoes?.length === 1, JSON.stringify(st.j.citacoes));
  const blocosCand = k => (promptSiteTxt.match(new RegExp(`Proposta do plano · ${k}`, "g")) || []).length;
  confere("mesmo número de propostas de cada candidato", blocosCand("Lula") === blocosCand("Flávio Bolsonaro"), `${blocosCand("Lula")} x ${blocosCand("Flávio Bolsonaro")}`);
  confere("site também consulta promessas e leis", /Promessa anterior|Acervo Constitucional/.test(promptSiteTxt));

  // Extrair afirmações de texto lido por OCR.
  resposta = { afirmacoes: ["Fulano vai acabar com o Bolsa Família"] };
  const e = await chamar({ modo: "extrair", texto: "URGENTE compartilhe: fulano vai acabar com o bolsa familia" });
  confere("extrair devolve afirmações", e.status === 200 && e.j.afirmacoes.length === 1);

  // Espectro: o prompt leva os exemplos já classificados e o guia de impostos.
  let promptEsp = "";
  resposta = p => { promptEsp = p; return { sobre: "indefinido", categoria: "per503", justificativa: "Tributar grandes fortunas é medida de redistribuição.", plano: "nao_consta", evidencias: [] }; };
  const s = await chamar({ modo: "espectro", frase: "taxar grandes fortunas e reduzir imposto de quem ganha pouco" });
  confere("espectro responde per503", s.j.categoria === "per503");
  confere("prompt do espectro tem guia e exemplos", promptEsp.includes("grandes fortunas") && promptEsp.includes("já classificadas"));

  // Site primeiro, web depois. Com o site bastando, a web não é chamada.
  process.env.TAVILY_API_KEY = "teste";
  tavily = [];
  resposta = p => p.includes("Você prepara buscas")
    ? { sobre: "ambos", consultas_plano: ["escala 6x1"], consultas_web: ["checagem escala 6x1"] }
    : { resposta: "Resposta só com o site, longa o bastante.", citacoes: [], suficiente: true };
  const so = await chamar({ modo: "site", pergunta: "O que o site diz sobre a escala 6x1 dos dois?" });
  confere("site bastou: sem busca na web", so.status === 200 && tavily.length === 0 && so.j.web?.estado === "nao_precisou", JSON.stringify(so.j.web));

  // Site não bastou: busca profunda (várias consultas, avançada) e segunda resposta com blocos [W].
  tavily = [];
  let segunda = "";
  resposta = p => {
    if (p.includes("Você prepara buscas")) return { sobre: "ambos", consultas_plano: ["declaração"], consultas_web: ["checagem declaração candidato", "reportagem declaração"] };
    if (!p.includes("BUSCA NA WEB FEITA AGORA")) return { resposta: "O site não tem essa declaração registrada.", citacoes: [], suficiente: false, buscar: ["discurso candidato declaração"] };
    segunda = p;
    return { resposta: "Segundo a agência, a declaração não aparece em discursos [W0] e há dados oficiais [W1, W9].", citacoes: [{ id: "W0", trecho: "não aparece em nenhum discurso registrado" }] };
  };
  const sw = await chamar({ modo: "site", pergunta: "É verdade que o candidato disse isso ontem no comício?" });
  const lista = tavily.filter(b => Array.isArray(b.include_domains)), aberta = tavily.filter(b => !b.include_domains);
  confere("site não bastou: busca em várias consultas, avançada", lista.length >= 3 && tavily.every(b => b.search_depth === "advanced"), tavily.length + " buscas");
  confere("poucas páginas na lista (2): entra a web aberta, do Brasil", aberta.length > 0 && aberta.every(b => b.country === "brazil") && sw.j.web?.ampla === true);
  confere("a consulta pedida pela IA entra na busca", tavily.some(b => b.query === "discurso candidato declaração"));
  confere("segunda resposta recebe blocos [W] com o tipo da fonte", segunda.includes("[W0] aosfatos.org (agência de checagem)"));
  confere("fonte da web vira fonte numerada; id inexistente some", sw.j.fontes?.some(f => f.id === "W0" && f.url.includes("aosfatos")) && !sw.j.resposta.includes("W9"), sw.j.resposta);
  confere("citação literal da web aceita", sw.j.citacoes?.length === 1 && sw.j.descartadas === 0);
  confere("resposta diz que usou a web", sw.j.web?.estado === "feita" && sw.j.web.usada === true, JSON.stringify(sw.j.web));

  // Checagem de fala: site não bastou -> imprensa com o tipo da fonte.
  tavily = [];
  resposta = p => {
    if (p.includes("Você prepara buscas")) return { sobre: "ambos", consultas_plano: ["salário mínimo"], consultas_web: ["checagem salário mínimo"] };
    if (!p.includes("BUSCA NA WEB FEITA AGORA")) return { sobre: "ambos", classificacao: "nao_e_proposta", explicacao: "A frase fala de uma declaração que o site não registra.", evidencias: [], checagens: [], limites: "", suficiente: false, buscar: [] };
    return { sobre: "ambos", classificacao: "nao_e_proposta", explicacao: "Segundo o Aos Fatos, a declaração não foi encontrada.", evidencias: [], imprensa: [{ indice: 0, resumo: "Aos Fatos não achou a declaração." }, { indice: 7, resumo: "inventado" }], checagens: [], limites: "" };
  };
  const ck = await chamar({ frase: "o candidato disse ontem que vai congelar o salário mínimo", candidato: "ambos" });
  confere("checagem usa a web quando o site não basta", ck.status === 200 && ck.j.imprensa?.length === 1 && ck.j.imprensa[0].tipo === "checagem", JSON.stringify(ck.j.imprensa));
  confere("checagem informa a busca", ck.j.web?.estado === "feita");

  // Acervo: artigos não bastaram -> web em legislação e tribunais.
  tavily = [];
  resposta = p => {
    if (p.includes("prepara a busca de artigos")) return { consultas: ["duração do trabalho"], documentos: ["cf"], consultas_web: ["STF jornada de trabalho"] };
    if (!p.includes("BUSCA NA WEB FEITA AGORA")) return { resposta: "Os artigos fixam a jornada, mas não dizem se há mudança em tramitação.", citacoes: [], suficiente: false, buscar: ["PEC fim da escala 6x1 tramitação"] };
    return { resposta: "A Constituição fixa 44 horas [W1]; há proposta em tramitação, segundo a imprensa.", citacoes: [], web: [{ indice: 1, resumo: "Reportagem sobre a proposta." }] };
  };
  const ac = await chamar({ modo: "acervo", pergunta: "Existe alguma mudança em andamento na jornada de trabalho da Constituição?" });
  confere("acervo busca na web com a lista jurídica", tavily.length >= 2 && tavily[0].include_domains.includes("planalto.gov.br"));
  confere("acervo devolve a página usada e tira [W] do texto", ac.j.imprensa?.length === 1 && ac.j.imprensa[0].tipo === "imprensa" && !ac.j.resposta.includes("[W"), ac.j.resposta);
  delete process.env.TAVILY_API_KEY;

  // Sem resposta da IA: 503 com detalhe.
  global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "rate limit" } }) });
  const f = await chamar({ frase: "o candidato vai acabar com a escala 6x1", candidato: "ambos" });
  confere("503 traz detalhe", f.status === 503 && Array.isArray(f.j.detalhe) && f.j.detalhe.length > 0, JSON.stringify(f.j.detalhe));

  console.log(falhas ? `${falhas} falha(s)` : "tudo certo");
  process.exitCode = falhas ? 1 : 0;
})();
