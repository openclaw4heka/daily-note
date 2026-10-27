import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { CATEGORIES } from './util.mjs';

const MODEL = 'claude-opus-5-5';

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client;
function getClient() {
  client ??= new Anthropic();
  return client;
}

async function structured({ system, user, schema, effort }) {
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort, format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (response.stop_reason === 'refusal') throw new Error('AI 拒絕處理這段內容');
  if (response.stop_reason === 'max_tokens') throw new Error('AI 回應被截斷');
  if (!response.parsed_output) throw new Error('AI 回應格式不符');
  return response.parsed_output;
}

const EntrySchema = z.object({
  summary: z.string(),
  mood: z.enum(['好', '普通', '累', '低落', '焦慮', '未提及']),
  tasks: z.array(
    z.object({
      title: z.string(),
      estimate_min: z.number().int().nullable(),
      quote: z.string().nullable(),
      category: z.enum(CATEGORIES),
      due_date: z.string().nullable(),
    }),
  ),
  time_spent: z.array(
    z.object({
      task_title: z.string(),
      minutes: z.number().int(),
      quote: z.string(),
    }),
  ),
  observations: z.array(z.string()),
});

const ENTRY_SYSTEM = `你是「對帳」App 的整理助手。使用者用口語（常是語音轉文字）記下今天的事，你把它整理成結構化資料。使用繁體中文（台灣用語）。

規則：
- summary：2–3 句，用使用者的觀點寫，不加評價。
- tasks：只抓「接下來要做」的具體事項，不要抓已經做完的事。title 要短（15 字內），動詞開頭。
- estimate_min：只有使用者明確說出時間（例如「一個小時」「四十五分鐘吧」）才填，換算成分鐘；沒說就填 null，絕對不要自己推估。
- quote：使用者講到時間的原話片段，例如「應該一個小時」；沒有就 null。
- due_date：使用者有明確指出日期才填 YYYY-MM-DD（依提供的今天日期換算「明天」「週四」等）；今天要做或沒說就填 null。
- time_spent：使用者明確說某件事「花了多久／做了多久」才列，否則空陣列。
- observations：最多 2 條「根據這篇的可能觀察」，必須直接有紀錄支持；不要把同時發生的事當成因果；不要人格評價（不能說懶、逃避、拖延成性之類）；沒有就空陣列。
- 使用者標記過「不對」的觀察會附在後面，不要再提出相同或相近的判斷。`;

export async function analyzeEntry({ text, day, rejected = [] }) {
  const rejectedText = rejected.length
    ? `\n\n使用者先前否定過的觀察（不要再用）：\n${rejected.map((r) => `- ${r}`).join('\n')}`
    : '';
  return structured({
    system: ENTRY_SYSTEM,
    user: `今天日期：${day}\n\n紀錄原文：\n${text}${rejectedText}`,
    schema: EntrySchema,
    effort: 'low',
  });
}

const WeeklySchema = z.object({
  patterns: z.array(
    z.object({
      text: z.string(),
      tone: z.enum(['warn', 'good', 'neutral']),
      bet_ids: z.array(z.string()),
    }),
  ),
  data_gaps: z.array(z.string()),
  suggestion: z.object({
    change: z.string(),
    basis: z.string(),
    prediction_example: z.string(),
  }),
});

const WEEKLY_SYSTEM = `你是「對帳」App 的每週回顧助手。輸入是使用者這一週的押注（早上說要做的事）、對帳結果、紀錄摘要與上週的調整。使用繁體中文（台灣用語）。

輸出：
- patterns：2–4 條看得到的模式。每條都要能被資料直接支持，並在 bet_ids 列出依據的押注 id。用中性描述數字與差距（例如「提案類 4 件有 3 件超時，實際平均是預估的 2.3 倍」）。這些是「可能原因，待使用者確認」，不是定論。
- data_gaps：判斷時缺少的資料（例如哪幾天沒紀錄、幾件沒填時間）。沒有紀錄的日子是「資料不足」，不能當成沒做事。
- suggestion：下週只改「一件事」，要具體、可執行、可在下週驗證；basis 說明依據哪一條模式；prediction_example 給一個可量測的預測範例。

硬性規則：
- 沒填時間的押注不推算時間。
- 同時發生不等於因果。
- 不做人格評價，不說教，不灌雞湯。
- 使用者否定過的模式（附在輸入中）不要再提出。`;

export async function weeklyReview(input) {
  return structured({
    system: WEEKLY_SYSTEM,
    user: JSON.stringify(input),
    schema: WeeklySchema,
    effort: 'medium',
  });
}
