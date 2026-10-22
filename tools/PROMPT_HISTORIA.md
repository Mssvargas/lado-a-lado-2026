# Prompts: história das eleições e dos governos

Instruções para preencher os dados da aba "Eleições desde 1891":

- a posição ideológica de cada candidato;
- as séries econômicas e sociais por ano;
- os avanços e as críticas de cada governo.

O site é APARTIDÁRIO. Hoje é 22/10/2026.

## Regras para todas as partes

- O mesmo critério, o mesmo formato e o mesmo número de itens valem para todos.
- Nunca invente número, data, autor, classificação ou URL. Abra cada fonte antes de
  citá-la. Se não há fonte, registre `null` ou `"sem_classificacao"` e explique em `nota`.
- Ferramentas:
  - Carregue WebSearch e WebFetch com ToolSearch (`"select:WebSearch,WebFetch"`).
  - Em comandos de rede via Bash, use `--max-time 60`.
  - Escreva scripts auxiliares num arquivo `.py`. Nunca use `python -c` com várias linhas.
  - Valide o JSON com `python -I -X utf8`.
- Grave o arquivo inteiro de novo a cada lote concluído, para não perder trabalho.

---

## A. Posição ideológica dos candidatos

**Entrada:** `data/eleicoes.json`, que tem 33 eleições e 185 candidatos, cada um com nome
e partido. As famílias ideológicas do site estão em `data/ideologias.json`, nos campos
`id` e `nome`.

**Saída:** `data/eleicoes_ideologia.json`.

```json
{"metodo":"…","escala":["esquerda","centro-esquerda","centro","centro-direita","direita"],
 "partidos":{"PTB@1945-1965":{"eixo":"centro-esquerda","familia":"trabalhismo","fontes":[{"titulo":"…","url":"…"}],"nota":"…"}},
 "candidatos":[{"ano":1950,"nome":"Getúlio Vargas","partido":"PTB","eixo":"centro-esquerda","familia":"trabalhismo","base":"partido|pessoal","fontes":[…],"nota":""}]}
```

**Método, nesta ordem:**

1. **Partido no período (1945 em diante):**
   - Use escalas de especialistas: Bolognesi, Ribeiro e Codato (2023), Power e Zucco
     (Brazilian Legislative Surveys), Tarouco e Madeira (2013).
   - Para 1945–1965, use os verbetes do CPDOC/FGV e a historiografia acadêmica.
   - O mesmo partido pode mudar de posição ao longo do tempo. Por isso a chave é
     `SIGLA@período`.
2. **Sem partido, ou antes de 1930:**
   - Use a posição pessoal documentada no verbete do CPDOC/FGV ou em obra acadêmica, com
     `"base":"pessoal"`.
   - Na Primeira República, os partidos eram republicanos estaduais (PRP, PRM e outros).
     Classifique o eixo só se a fonte classificar. Senão, use `"eixo":"sem_classificacao"`,
     com a família que a fonte indicar (ex.: liberalismo oligárquico, positivismo).
3. **`familia`:** use o `id` de `data/ideologias.json` quando houver correspondência
   (comunismo, socialismo, social-democracia, trabalhismo, liberalismo, conservadorismo,
   nacionalismo e outras). Se não houver, use texto curto.
4. **Extremos:** "extrema-esquerda" e "extrema-direita" só entram quando a fonte usar
   esses termos, e com a fonte citada.

---

## B. Séries anuais da economia e da sociedade (1889 a 2025)

**Saída:** `data/series_historicas.json`.

```json
{"series":{"pib_real_pct":{"nome":"Crescimento do PIB","unidade":"% ao ano","fontes":[{"periodo":"1901-1946","titulo":"…","url":"…"}],"nota":"…","valores":{"1901":…}},
 "inflacao_pct":{…},"resultado_primario_pct_pib":{…},"resultado_nominal_pct_pib":{…},"divida_pct_pib":{…},
 "analfabetismo_pct":{…},"ideb_anos_iniciais":{…},"pobreza_pct":{…},"extrema_pobreza_pct":{…}}}
```

**Fontes oficiais ou de referência:**

- IBGE: Estatísticas do Século XX, SIDRA, censos e PNAD.
- Ipeadata (séries históricas).
- Banco Central: SGS, NFSP e dívida.
- Tesouro Nacional.
- INEP (Ideb).
- Ipea, para pobreza com a linha de pobreza informada.
- Banco Mundial (PIP), também com a linha informada.

**Regras:**

- **Encadeamento:** quando uma série muda de fonte ou de índice (ex.: inflação pelo
  IGP-DI até 1979 e pelo IPCA a partir de 1980), registre cada trecho em `fontes`.
- **Anos sem dado:** use `null`. Não interpole.
- **Censos:** o analfabetismo vem dos censos e da PNAD. Grave só os anos que têm dado.

---

## C. Governos: avanços e críticas

**Saída:** `data/governos/<periodo>.json` (o período vem no pedido).

```json
{"governos":[{"id":"vargas-1951","presidente":"Getúlio Vargas","inicio":"1951-01-31","fim":"1954-08-24",
 "partido":"PTB","chegada":"eleição direta|eleição indireta|golpe ou ruptura|sucessão (vice ou linha sucessória)|junta",
 "contexto":"1 a 2 frases neutras",
 "avancos":[{"texto":"…","fonte":{"titulo":"…","url":"…"}}],
 "criticas":[{"texto":"…","autor_da_critica":"quem faz a crítica (historiografia, TCU…)","fonte":{"titulo":"…","url":"…"}}],
 "nota":""}]}
```

**Como escrever:**

- Exatamente 3 avanços e 3 críticas por governo, com o mesmo tamanho e o mesmo tom para
  todos.
- **Avanço:** algo que o governo fez e que fontes de referência registram como marco
  (lei, instituição, obra, política, indicador).
- **Crítica:** um problema registrado por fonte de referência (crise, denúncia comprovada,
  resultado negativo, ruptura democrática, repressão). Diga quem faz a crítica.
- **Fontes aceitas:**
  - verbetes do CPDOC/FGV (DHBB) e da Biblioteca da Presidência;
  - obras acadêmicas;
  - relatórios oficiais (Comissão Nacional da Verdade, TCU);
  - organismos internacionais.
- **Fontes não aceitas:** opinião de veículo, blog, site partidário. Reportagem só vale para
  provar que um fato aconteceu.
- Em governos recentes, o cuidado com a simetria é maior: os mesmos tipos de fonte para
  todos.
- **Período:** um presidente que governou em períodos diferentes tem uma entrada por
  período (ex.: Vargas de 1930 a 1945 e de 1951 a 1954). Incluem-se vices que assumiram,
  juntas e interinos com mais de 30 dias.
