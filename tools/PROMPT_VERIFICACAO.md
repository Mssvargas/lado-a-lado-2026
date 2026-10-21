# Prompt: verificação de promessas em fontes oficiais

Instruções usadas para preencher o campo `verificacao_oficial` de cada promessa em
`data/promessas.json`. A ideia é conferir cada promessa nos registros oficiais primários,
sem depender do julgamento de reportagens, e depois comparar o resultado com o dos
levantamentos jornalísticos.

---

Você vai verificar promessas de governos anteriores e do atual para um site público e
APARTIDÁRIO. Hoje é 21/10/2026.

**Regras absolutas:**

- mesmo critério e mesmo rigor para todos os governos;
- nunca invente norma, número, data ou URL;
- abra cada fonte antes de citar.

Carregue WebSearch e WebFetch com ToolSearch ("select:WebSearch,WebFetch"). Em comandos
de rede via Bash, use sempre `--max-time 60`.

## FONTES ACEITAS (oficiais e primárias)

- **Normas:** planalto.gov.br (legislação compilada), Diário Oficial (in.gov.br),
  normas.leg.br.
- **Tramitação:** APIs e portais da Câmara (dadosabertos.camara.leg.br, camara.leg.br) e
  do Senado (legis.senado.leg.br, www25.senado.leg.br).
- **Dados oficiais:** IBGE (sidra.ibge.gov.br), Banco Central, Tesouro Nacional (Tesouro
  Transparente), Portal da Transparência, SIOP, Ipeadata, painéis e dados abertos de
  ministérios e autarquias (dados.gov.br, INEP, DATASUS, CAIXA etc.).
- **Auditorias:** TCU (acórdãos e relatórios) e CGU.
- **Decisões:** STF (portal.stf.jus.br).

**Notícias de gov.br** só valem para provar que um ATO aconteceu (lançamento, assinatura),
nunca para provar RESULTADO; resultado exige dado oficial.

**NÃO use reportagens jornalísticas** como prova. O objetivo é justamente comparar com
elas.

## CRITÉRIO DE STATUS (igual para todos)

- **"cumprida":** há ato oficial (lei, emenda, decreto, portaria) ou entrega registrada em
  fonte oficial que atende o núcleo da promessa, dentro do mandato. Se a promessa tem meta
  numérica, o dado oficial mostra a meta atingida.
- **"parcial":** o ato ou a entrega atende só parte do núcleo, ou a meta numérica foi
  atingida em parte. Informe o percentual atingido em `percentual`, quando der para
  calcular.
- **"nao_cumprida":** as fontes oficiais mostram que o ato ou a entrega não ocorreu, ou que
  foi revogado ou vetado, ou que a meta não foi atingida, e o mandato terminou.
- **"em_andamento":** só para o mandato atual (Lula 3, 2023–2026). Há ato oficial iniciado
  (projeto enviado, programa criado), sem conclusão até 21/10/2026. Também vale para
  promessa do mandato atual sem ato oficial ou com resultado ainda contrário: o mandato
  não terminou, então ela fica em_andamento, com `"mandato_em_curso": true` e a nota
  "Mandato em curso: até 21/10/2026 não há ato oficial ou dado que mostre a promessa
  cumprida." No mandato atual, "nao_cumprida" só vale quando o fato já está consumado e
  não há mais como cumprir (ex.: prazo vencido, decisão definitiva em sentido oposto).
- **"nao_verificavel":** a promessa é genérica demais para ter critério mensurável, ou não
  existe dado oficial público que permita conferir.

Avalie o que a promessa diz, e não o que a reportagem disse. Se o núcleo da promessa for
ambíguo, escolha a leitura mais literal e explique.

## ENTRADA E SAÍDA

- **Arquivo:** `C:\Users\marlon.vargas\repos\lado-a-lado-2026\data\promessas.json`, com
  `levantamentos[]` (`id`, `registro`, `governo`, `fonte`) e `itens[]` (`promessa`,
  `status`, `status_original`, `avaliacao`, `evidencias`).
- **Escopo:** processe SÓ os levantamentos indicados abaixo.
- **Saída:** escreva
  `C:\Users\marlon.vargas\repos\lado-a-lado-2026\data\verificacao\<grupo>.json` (UTF-8,
  JSON válido; valide com `python -I`) e regrave o arquivo inteiro depois de CADA 5 itens
  concluídos, para não perder trabalho.

```json
{"grupo":"<grupo>","levantamentos":["<id>", "..."],"itens":[{
  "levantamento":"g1-bolsonaro","indice":0,
  "status":"cumprida|parcial|nao_cumprida|em_andamento|nao_verificavel",
  "percentual":null,
  "justificativa":"1 a 3 frases neutras: o que a fonte oficial mostra",
  "evidencias":[{"descricao":"Lei 13.954/2019","tipo":"norma|tramitacao|dado_oficial|auditoria|decisao|ato_publicado","url":"..."}],
  "data_verificacao":"2026-10-21"
}]}
```

**`indice`** é a posição do item em `levantamentos[x].itens` (base 0).

**Promessa repetida** entre levantamentos do mesmo governo: reaproveite a sua verificação,
desde que o enunciado seja equivalente, e cite as mesmas evidências.

## Resposta final

Responda só com:

- a contagem de status por levantamento: seu resultado ao lado do da fonte;
- os itens com maior divergência;
- os casos de dúvida.
