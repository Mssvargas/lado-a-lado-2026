# Prompt: entregas que não estavam prometidas

Instruções para preencher `data/entregas/<governo>.json`. São as principais entregas de
cada governo que não constavam do plano de governo nem dos levantamentos de promessas,
com o que dizem as avaliações sobre o resultado. O site mostra evidências, sem veredito
de "boa" ou "ruim".

---

Você vai levantar entregas de um governo para um site público e APARTIDÁRIO. Hoje é
21/10/2026.

**Regras absolutas:**

- mesmo critério, mesmo número de itens e mesmo rigor para todos os governos;
- nunca invente norma, número, data, autor ou URL;
- abra cada fonte antes de citar.

Carregue WebSearch e WebFetch com ToolSearch ("select:WebSearch,WebFetch"). Em comandos
de rede via Bash, use sempre `--max-time 60`. Grave scripts auxiliares num arquivo `.py`
no scratchpad, nunca em `python -c` com várias linhas.

## 1. Como escolher as entregas (critério igual para todos)

1. **Candidatas:** as entregas que o próprio governo destacou nas **Mensagens ao
   Congresso Nacional** do mandato (documento oficial anual da Presidência, em
   gov.br/planalto ou na biblioteca da Presidência). Assim, a escolha parte do que cada
   governo considerou mais importante, e não de um julgamento do site.
2. **Entrega é ato concluído:** lei, emenda, medida provisória convertida, decreto ou
   programa criado e executado. Anúncio ou projeto não aprovado não conta.
3. **Não prometida:** a entrega não aparece no plano de governo registrado (texto
   integral em `data/planos/<id>.json`, formato `{"pages":[{"p","t"}]}`; procure por
   palavras-chave e sinônimos) nem nos itens dos levantamentos em `data/promessas.json`
   daquele governo. Registre em `busca_no_plano` os termos que você procurou.
4. **Entre as candidatas que sobrarem, fique com as 8 de maior alcance**, medido por dado
   oficial: orçamento executado (Portal da Transparência, SIOP, Tesouro) ou número de
   pessoas atendidas. Em empate, prefira variar as áreas.
5. Respostas a emergências (ex.: pandemia) contam como entrega não prometida, marcadas
   com `"contexto": "emergencia"`.

## 2. O que dizem as avaliações

Para cada entrega, procure o que se sabe sobre o resultado:

- **Avaliações oficiais:** TCU (acórdãos e auditorias), CGU, CMAP (Conselho de
  Monitoramento e Avaliação de Políticas Públicas), Ipea, IFI do Senado, consultorias
  da Câmara e do Senado, Banco Central.
- **Estudos acadêmicos revisados por pares**, organismos internacionais (Banco Mundial,
  OCDE, FMI, OMS) e textos para discussão de centros de pesquisa reconhecidos.
- **Não use reportagem** como avaliação.

Traga achados **favoráveis e desfavoráveis** quando existirem; não escolha só um lado.
Classifique o conjunto em `balanco`:

- `favoravel`: os estudos indicam que a entrega alcançou o objetivo declarado;
- `mista`: há achados nos dois sentidos, ou alcançou parte;
- `desfavoravel`: os estudos indicam que não alcançou o objetivo, ou teve efeito oposto;
- `insuficiente`: não há avaliação publicada.

`balanco` resume o que dizem as avaliações sobre o **objetivo declarado da própria
entrega**. Não é opinião sobre se a política é desejável.

## 3. Saída

Escreva `data/entregas/<governo>.json` (UTF-8, JSON válido; valide com `python -I`) e
regrave o arquivo inteiro depois de cada 2 entregas concluídas.

```json
{"governo":"bolsonaro","nome":"Jair Bolsonaro (2019–2022)","registros":["bolsonaro-2018"],
 "criterio":"1 a 2 frases sobre como as 8 foram escolhidas, com as Mensagens usadas",
 "fontes_mensagens":[{"ano":2020,"url":"..."}],
 "itens":[{
   "titulo":"nome curto",
   "o_que_e":"1 a 2 frases simples, sem adjetivo valorativo",
   "atos":[{"descricao":"Lei 14.020/2020","url":"..."}],
   "data":"2020-04-01",
   "tema":"id de tema de data/comparativo.json, ou 'outro'",
   "contexto":"normal|emergencia",
   "alcance":{"texto":"dado oficial de orçamento ou de público, com período","url":"..."},
   "busca_no_plano":"termos procurados no plano e nos levantamentos, sem resultado",
   "avaliacoes":[{"achado":"1 frase","autor":"TCU","ano":2021,"tipo":"avaliacao_oficial|academico_revisado|organismo_internacional|working_paper","sentido":"favoravel|desfavoravel|misto","titulo":"...","url":"..."}],
   "balanco":"favoravel|mista|desfavoravel|insuficiente",
   "resumo_avaliacoes":"1 a 3 frases neutras sobre o conjunto das avaliações",
   "quem_ganha":"1 frase",
   "quem_paga_ou_perde":"1 frase (custo fiscal, quem financia, quem perde)"
 }]}
```

## Resposta final

Responda só com:

- as 8 entregas escolhidas, cada uma com o balanço;
- as candidatas descartadas por terem sido prometidas;
- os casos de dúvida.
