import { z } from 'zod';

/** 参考图尺寸硬约束（同时是 --ref-* component token 的来源） */
export const RefImageSchema = z.object({
  width: z.number().int().min(300),
  height: z.number().int().min(300),
  /** 宽高比 0.4–2.5 */
  aspect: z.number().refine((v) => v >= 0.4 && v <= 2.5, '参考图宽高比超出 0.4–2.5'),
});

/** 生成参数（按 Seedance 参数推测的契约） */
export const GenParamsSchema = z.object({
  model: z.string().min(1),
  prompt: z.string().min(1),
  ratio: z.enum(['9:16', '3:4', '4:5', '1:1', '4:3', '16:9', '2.39:1']),
  batch: z.number().int().min(1).max(8),
  /** 参考图（最多 30 张，接口上限） */
  refs: z.array(z.string()).max(30),
});

export type GenParams = z.infer<typeof GenParamsSchema>;

export const ShotVerdictSchema = z.enum(['ok', 'redo']);

/** 出入参统一走 schema 校验，坏数据进不来 */
export function parseGenParams(p: unknown): GenParams {
  return GenParamsSchema.parse(p);
}
