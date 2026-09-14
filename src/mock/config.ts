/** Mock 能力配置：模拟后端下发的生成能力（模型列表、画幅档） */
export interface MockConfig {
  models: string[];
  ratios: string[];
}

export const MOCK_CONFIG: MockConfig = {
  models: ['Seedance 2.0', '可灵 3.0', 'Nano Banana', 'Runway Gen-4', 'Pika 2.2'],
  ratios: ['9:16', '16:9', '1:1', '3:4'],
};
