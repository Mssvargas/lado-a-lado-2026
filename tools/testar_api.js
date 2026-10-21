// Teste local da API sem gastar cota: a IA é simulada, o resto (busca, validação) é real.
// Uso (na raiz do repositório): node tools/testar_api.js
process.env.GROQ_API_KEY = "teste";
const handler = require("../api/checar.js");

let resposta = {};
global.fetch = async (url, op) => {
  const body = typeof op.body === "string" ? JSON.parse(op.body) : {};
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

  // Sem resposta da IA: 503 com detalhe.
  global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "rate limit" } }) });
  const f = await chamar({ frase: "o candidato vai acabar com a escala 6x1", candidato: "ambos" });
  confere("503 traz detalhe", f.status === 503 && Array.isArray(f.j.detalhe) && f.j.detalhe.length > 0, JSON.stringify(f.j.detalhe));

  console.log(falhas ? `${falhas} falha(s)` : "tudo certo");
  process.exitCode = falhas ? 1 : 0;
})();
