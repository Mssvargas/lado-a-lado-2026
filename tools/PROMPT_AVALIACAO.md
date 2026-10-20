# Prompt: avaliação de viabilidade, evidências e proposições

Instruções usadas para gerar `data/avaliacao/*.json`, um arquivo por grupo de temas. Os
agentes recebem este texto e a lista de temas do seu grupo.

---

Você vai avaliar propostas dos planos de governo para um site público e APARTIDÁRIO sobre
a eleição presidencial brasileira. Hoje é 20/10/2026.

**Neutralidade e exatidão são requisitos absolutos:**

- mesmo rigor, mesmo tamanho e mesmo tom para todos os candidatos;
- nunca dê veredito de "boa" ou "ruim";
- nunca invente estudo, número, projeto, situação ou URL;
- abra cada fonte antes de citar.

Carregue WebSearch e WebFetch com ToolSearch ("select:WebSearch,WebFetch").

**ARQUIVOS** (pasta `C:\Users\marlon.vargas\repos\lado-a-lado-2026\data\`):

- `eleicao.json`: candidatos;
- `comparativo.json`: `temas[].itens[]`, com `candidato`, `proposta`, `trecho`, `pagina`,
  `simples`, `detalha`;
- `resumo.json`: resumo de 2 frases por tema e candidato;
- `espectro.json`: classificação esquerda–direita de cada item, em `itens[]`, com `tema`,
  `indice`, `categoria` e `direcao`.

## PASSO 1: escolha das propostas principais

Em cada tema do seu grupo, escolha de 2 a 3 itens de CADA candidato: os que o resumo do
tema menciona. Use o mesmo número para os dois candidatos dentro do tema. O `indice` é a
posição do item em `temas[x].itens` (base 0).

## PASSO 2: avaliação de cada proposta

1. **Viabilidade: instrumento.** Que instrumento a proposta exige?
   - "ato_executivo": decreto ou portaria, o presidente faz sozinho;
   - "lei_ordinaria": maioria simples;
   - "lei_complementar": maioria absoluta, 257 deputados e 41 senadores;
   - "pec": 3/5 nas duas Casas, em dois turnos;
   - "pec_clausula_petrea": quando há debate jurídico relevante sobre cláusula pétrea;
   - "politica_existente": a proposta só mantém ou amplia algo que já existe;
   - "nao_se_aplica".

   Explique em 1 a 2 frases e cite o artigo da Constituição ou a lei, com link do
   planalto.gov.br.
2. **Viabilidade: custo.** Classifique como:
   - "estimado_com_fonte": o plano diz quanto custa e de onde vem o dinheiro;
   - "estimado_sem_fonte";
   - "nao_estimado";
   - "sem_custo_relevante".

   Em `plano_diz`, registre o que o plano afirma. Em `estimativa_externa`, registre uma
   estimativa da IFI, do Tesouro, do Ipea, do TCU ou de estudo acadêmico, se existir, com
   link. Se não existir, use null.
3. **Viabilidade: competência e prazo.**
   - Competência: "federal", "compartilhada" ou "depende_estados_municipios" (arts. 21 a 24
     e 30 da Constituição).
   - Prazo: "cabe_em_4_anos", "alem_de_4_anos" ou "incerto", com 1 frase de explicação.
4. **Evidência de que funciona.**
   - Reúna de 2 a 4 estudos ou avaliações. Prefira avaliações oficiais (Ipea, TCU,
     ministérios), revisões sistemáticas, artigos revisados por pares e experiências de
     outros países.
   - INCLUA ACHADOS FAVORÁVEIS E DESFAVORÁVEIS quando existirem. Não escolha só os de um
     lado.
   - Nível: "favoravel", "mista", "desfavoravel" ou "insuficiente".
   - Consenso: "alto", "medio" ou "baixo".
   - Resumo neutro em 2 frases.
   - Se a proposta for vaga demais para avaliar, use "insuficiente" e explique.
5. **Impactos.** Diga quem ganha e quem paga ou perde, segundo as fontes, em 1 a 2 frases
   cada, sem adjetivos.
6. **Comparação.** Indique a proposta equivalente do OUTRO candidato no mesmo tema
   (`tema`, `indice`), se houver uma minimamente comparável, e 1 frase neutra sobre a
   diferença de abordagem. Se não houver, use null.
7. **Proposições.** Liste até 4 por proposta: projetos, PECs ou ações em tramitação ou
   decididas ligadas a ela.
   - Fontes: API da Câmara (https://dadosabertos.camara.leg.br/api/v2/proposicoes?keywords=...),
     API do Senado (https://legis.senado.leg.br/dadosabertos/), portal do STF e resoluções do
     TSE.
   - Para cada uma, registre casa, tipo e número, ementa curta, autor e partido, situação
     atual, data e descrição do último andamento, URL oficial, a direção esquerda/direita
     pela categoria do Manifesto Project (ver `espectro.json`, `categorias`) e 1 frase sobre
     a relação com a proposta.
   - Confirme a situação na fonte oficial.

## SAÍDA

Escreva `C:\Users\marlon.vargas\repos\lado-a-lado-2026\data\avaliacao\<grupo>.json`
(UTF-8, JSON válido; valide com `python -I`):

```json
{"grupo": "<grupo>", "temas": ["..."], "itens": [{
  "tema": "seguranca", "indice": 9, "candidato": "flavio", "proposta": "(copie do comparativo)",
  "viabilidade": {
    "instrumento": {"nivel": "...", "explicacao": "...", "fontes": [{"titulo": "...", "url": "..."}]},
    "custo": {"nivel": "...", "plano_diz": "...", "estimativa_externa": "... ou null", "fontes": []},
    "competencia": {"nivel": "...", "prazo": "...", "explicacao": "...", "fontes": []},
    "evidencia": {"nivel": "...", "consenso": "...", "resumo": "...", "estudos": [{"titulo": "...", "autor": "...", "ano": 2020, "achado": "1 frase", "url": "..."}]}
  },
  "impactos": {"quem_ganha": "...", "quem_paga_ou_perde": "...", "fontes": []},
  "comparacao": {"tema": "seguranca", "indice": 2, "candidato": "lula", "diferenca": "..."},
  "proposicoes": [{"casa": "Câmara", "tipo": "PEC", "numero": "PEC 32/2015", "ementa": "...", "autor": "...", "partido": "...", "situacao": "...", "ultima_acao": "AAAA-MM-DD: ...", "url": "...", "direcao": "esquerda|direita|fora do RILE", "relacao": "..."}]
}]}
```

Ao terminar, responda só com:

- quantos itens por candidato;
- quantos estudos e proposições no total;
- os casos em que teve dúvida de neutralidade ou não achou evidência.
