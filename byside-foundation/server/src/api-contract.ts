import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatRequest {
  @ApiProperty({ type: String, description: '伙伴要回复的文字', maxLength: 1000, example: '你好' }) text!: string;
  @ApiProperty({ type: String, description: '调用方生成的稳定 ID；同一 ID 同一内容可安全重试', maxLength: 100 }) requestId!: string;
}
export class MessageRecord {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) sessionId!: string;
  @ApiProperty({ type: String, enum: ['user', 'assistant'] }) role!: string;
  @ApiProperty({ type: String }) text!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}
export class ChatResponse {
  @ApiProperty({ type: String }) requestId!: string;
  @ApiProperty({ type: MessageRecord }) message!: MessageRecord;
}
export class MemoryRequest { @ApiProperty({ type: String, maxLength: 500 }) text!: string }
export class RespondRequest { @ApiProperty({ type: String, maxLength: 600 }) text!: string }
export class MemoryRecord extends MemoryRequest {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}
export class CompanionRecord {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String, enum: ['yatuan', 'human', 'custom'] }) character!: string;
  @ApiProperty({ type: String, nullable: true }) customImage!: string | null;
  @ApiProperty({ type: String }) personality!: string;
  @ApiProperty({ type: String }) mood!: string;
  @ApiProperty({ type: String }) motion!: string;
  @ApiProperty({ type: String }) speech!: string;
  @ApiProperty({ type: Number }) energy!: number;
  @ApiProperty({ type: Number }) intimacy!: number;
  @ApiProperty({ type: Number }) growth!: number;
  @ApiProperty({ type: Number }) growthStage!: number;
  @ApiProperty({ type: String }) flowerStyle!: string;
  @ApiProperty({ type: Number }) flowerCount!: number;
  @ApiProperty({ type: Number }) projectionX!: number;
  @ApiProperty({ type: Number }) projectionY!: number;
  @ApiProperty({ type: Number }) projectionScale!: number;
  @ApiProperty({ type: Boolean }) showStats!: boolean;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) lastChatGrowth!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}
export class SnapshotResponse {
  @ApiProperty({ type: CompanionRecord }) companion!: CompanionRecord;
  @ApiProperty({ type: [MessageRecord], description: '最近 200 条消息，按时间从旧到新' }) messages!: MessageRecord[];
  @ApiProperty({ type: [MemoryRecord] }) memories!: MemoryRecord[];
}
export class SpeechRequest { @ApiProperty({ type: String, maxLength: 1600 }) text!: string }
export class SpeechResponse {
  @ApiProperty({ type: String, example: 'audio/mpeg' }) mime!: string;
  @ApiProperty({ type: String, description: '完整音频的 Base64 内容' }) audio!: string;
}
export class VisionRequest {
  @ApiProperty({ type: String, description: 'PNG、JPEG 或 WebP 的 base64 data URL' }) image!: string;
  @ApiPropertyOptional({ type: String }) prompt?: string;
  @ApiPropertyOptional({ type: String }) requestId?: string;
}
export class VisionResponse {
  @ApiProperty({ type: String, enum: ['model', 'demo'] }) mode!: string;
  @ApiProperty({ type: String }) description!: string;
}
export class GrowthRequest {
  @ApiProperty({ type: String, maxLength: 100, description: '扩展内稳定唯一，重复提交不重复计算' }) eventId!: string;
  @ApiProperty({ type: String, maxLength: 80, example: 'meal.completed' }) kind!: string;
}
export class GrowthResponse {
  @ApiProperty({ type: Boolean }) duplicate!: boolean;
  @ApiPropertyOptional({ type: CompanionRecord }) companion?: CompanionRecord;
}
export class CompanionPatch {
  @ApiPropertyOptional({ type: String, enum: ['yatuan', 'human', 'custom'] }) character?: string;
  @ApiPropertyOptional({ type: String, enum: ['gentle', 'lively', 'witty'] }) personality?: string;
  @ApiPropertyOptional({ type: String, enum: ['happy', 'curious', 'sleepy', 'eating', 'listening'] }) mood?: string;
  @ApiPropertyOptional({ type: String, enum: ['idle', 'listening', 'thinking', 'speaking', 'happy', 'eating', 'sleeping'] }) motion?: string;
  @ApiPropertyOptional({ type: String, maxLength: 600 }) speech?: string;
  @ApiPropertyOptional({ type: String, enum: ['cream', 'pink', 'blue'] }) flowerStyle?: string;
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 3 }) flowerCount?: number;
  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 3840 }) projectionX?: number;
  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 2160 }) projectionY?: number;
  @ApiPropertyOptional({ type: Number, minimum: 0.5, maximum: 2 }) projectionScale?: number;
  @ApiPropertyOptional({ type: Boolean }) showStats?: boolean;
}
export class CharacterImageRequest {
  @ApiProperty({ type: String, description: 'PNG、JPEG、WebP 或 GIF 的 base64 data URL，解码后不超过 1.5 MB' }) image!: string;
}
export class DeviceRequest {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: [String], enum: ['camera', 'microphone', 'projection', 'speaker'] }) capabilities!: string[];
}
export class DeviceRecord {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, description: '设备能力数组的 JSON 字符串，保持 v1 兼容' }) capabilities!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}
export class LeaseRequest {
  @ApiProperty({ type: String, enum: ['camera', 'microphone', 'projection', 'speaker'] }) capability!: string;
}
export class LeaseResponse { @ApiProperty({ type: Number, example: 30 }) expiresIn!: number }
export class ProjectionResponse {
  @ApiProperty({ type: String, example: 'default' }) sessionId!: string;
  @ApiProperty({ type: CompanionRecord }) companion!: CompanionRecord;
}
export class SpeechStatus {
  @ApiProperty({ type: String, enum: ['doubao', 'bailian'] }) provider!: string;
  @ApiProperty({ type: Boolean, description: '密钥已配置，不代表供应商鉴权成功' }) asrConfigured!: boolean;
  @ApiProperty({ type: Boolean, description: '密钥已配置，不代表供应商鉴权成功' }) ttsConfigured!: boolean;
  @ApiProperty({ type: Boolean, description: '实时语音密钥已配置，不代表供应商鉴权成功' }) realtimeConfigured!: boolean;
}
export class HealthResponse {
  @ApiProperty({ type: Boolean }) ok!: boolean;
  @ApiProperty({ type: String, enum: ['demo', 'model'] }) mode!: string;
  @ApiProperty({ type: Boolean }) tts!: boolean;
  @ApiProperty({ type: SpeechStatus }) speech!: SpeechStatus;
  @ApiProperty({ type: String }) sessionId!: string;
}
