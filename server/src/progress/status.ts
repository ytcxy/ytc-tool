export type LearningStatus = 'unseen' | 'learning' | 'mastered';
const codes: Record<LearningStatus, number> = { unseen: 0, learning: 1, mastered: 2 };
export const statusCode = (status: LearningStatus): number => codes[status];
export function statusName(code: number): LearningStatus {
 switch (code) {
  case 0: return 'unseen';
  case 1: return 'learning';
  case 2: return 'mastered';
  default: throw new Error('INVALID_STORED_LEARNING_STATUS');
 }
}
