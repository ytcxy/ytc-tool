import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database.service';
import { CatalogService, visibleEpisode, visibleSentence } from '../catalog/catalog.service';
import { id, learningStatus, object } from '../common/input';
import { statusCode, statusName } from './status';
@Injectable()
export class ProgressService {
 constructor(private readonly db: DatabaseService, private readonly catalog: CatalogService) {}
 async episode(userId: string, episodeId: string) {
  await this.catalog.episode(episodeId);
  const [rows] = await this.db.pool.execute<RowDataPacket[]>(`SELECT s.id AS lastSentenceId,p.completed_at AS completedAt
    FROM el_episode_progress p JOIN el_episodes e ON e.id=p.episode_id JOIN el_collections c ON c.id=e.collection_id
    LEFT JOIN el_sentences s ON s.id=p.last_sentence_id AND s.episode_id=p.episode_id AND s.is_del=0
    WHERE p.user_id=? AND p.episode_id=? AND p.is_del=0 AND ${visibleEpisode}`, [userId, episodeId]);
  const [sentences] = await this.db.pool.execute<RowDataPacket[]>(`SELECT p.sentence_id AS id,p.status
    FROM el_sentence_progress p JOIN el_sentences s ON s.id=p.sentence_id
    JOIN el_episodes e ON e.id=s.episode_id JOIN el_collections c ON c.id=e.collection_id
    WHERE p.user_id=? AND s.episode_id=? AND p.is_del=0 AND ${visibleSentence}`, [userId, episodeId]);
  return { lastSentenceId: rows[0]?.lastSentenceId || null, completed: !!rows[0]?.completedAt,
   sentences: sentences.map(s => ({ id: s.id, status: statusName(s.status) })) };
 }
 private async ensureEpisodeProgress(connection: PoolConnection, userId: string, episodeId: string) {
  await connection.execute(`INSERT INTO el_episode_progress(user_id,episode_id) VALUES(?,?)
    ON DUPLICATE KEY UPDATE id=id`, [userId, episodeId]);
  const [rows] = await connection.execute<RowDataPacket[]>(
   'SELECT is_del FROM el_episode_progress WHERE user_id=? AND episode_id=? FOR UPDATE', [userId, episodeId]);
  if (rows[0].is_del !== 0) throw new ConflictException('学习记录已删除，需要管理员确认后恢复');
 }
 async saveEpisode(userId: string, episodeId: string, input: unknown) {
  await this.catalog.episode(episodeId);
  const body = object(input);
  const hasPosition = Object.hasOwn(body, 'lastSentenceId'), hasCompleted = Object.hasOwn(body, 'completed');
  if (!hasPosition && !hasCompleted) throw new BadRequestException('缺少学习进度');
  let sentenceId: string | null = null;
  if (hasPosition) {
   sentenceId = id(body.lastSentenceId);
   if ((await this.catalog.sentence(sentenceId)).episodeId !== episodeId) throw new BadRequestException('条目不属于当前单集');
  }
  if (hasCompleted && typeof body.completed !== 'boolean') throw new BadRequestException('完成状态必须为布尔值');
  const connection = await this.db.pool.getConnection();
  try {
   await connection.beginTransaction();
   await this.ensureEpisodeProgress(connection, userId, episodeId);
   if (hasPosition) await connection.execute(`UPDATE el_episode_progress
     SET last_sentence_id=?,last_studied_at=UTC_TIMESTAMP(3) WHERE user_id=? AND episode_id=? AND is_del=0`, [sentenceId, userId, episodeId]);
   if (hasCompleted) await connection.execute(`UPDATE el_episode_progress
     SET completed_at=IF(?,UTC_TIMESTAMP(3),NULL),last_studied_at=UTC_TIMESTAMP(3)
     WHERE user_id=? AND episode_id=? AND is_del=0`, [body.completed === true, userId, episodeId]);
   await connection.commit();
   return { ok: true };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
 }
 async saveSentence(userId: string, sentenceId: string, input: unknown) {
  const status = learningStatus(object(input).status), code = statusCode(status);
  const sentence = await this.catalog.sentence(sentenceId);
  const connection = await this.db.pool.getConnection();
  try {
   await connection.beginTransaction();
   // Lock the parent progress first in both save paths to keep lock ordering consistent.
   await this.ensureEpisodeProgress(connection, userId, sentence.episodeId);
   await connection.execute(`INSERT INTO el_sentence_progress(user_id,sentence_id) VALUES(?,?)
     ON DUPLICATE KEY UPDATE id=id`, [userId, sentenceId]);
   const [rows] = await connection.execute<RowDataPacket[]>(
    'SELECT is_del FROM el_sentence_progress WHERE user_id=? AND sentence_id=? FOR UPDATE', [userId, sentenceId]);
   if (rows[0].is_del !== 0) throw new ConflictException('条目记录已删除，需要管理员确认后恢复');
   await connection.execute(`UPDATE el_sentence_progress SET status=?,last_reviewed_at=UTC_TIMESTAMP(3)
     WHERE user_id=? AND sentence_id=? AND is_del=0`, [code, userId, sentenceId]);
   await connection.execute(`UPDATE el_episode_progress SET last_sentence_id=?,last_studied_at=UTC_TIMESTAMP(3)
     WHERE user_id=? AND episode_id=? AND is_del=0`, [sentenceId, userId, sentence.episodeId]);
   await connection.commit();
   return { ok: true, status };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
 }
 async summary(userId: string) {
  const [completed] = await this.db.pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS count
    FROM el_episode_progress p JOIN el_episodes e ON e.id=p.episode_id JOIN el_collections c ON c.id=e.collection_id
    WHERE p.user_id=? AND p.completed_at IS NOT NULL AND p.is_del=0 AND ${visibleEpisode}`, [userId]);
  const [counts] = await this.db.pool.execute<RowDataPacket[]>(`SELECT p.status,COUNT(*) AS count
    FROM el_sentence_progress p JOIN el_sentences s ON s.id=p.sentence_id JOIN el_episodes e ON e.id=s.episode_id
    JOIN el_collections c ON c.id=e.collection_id WHERE p.user_id=? AND p.is_del=0 AND ${visibleSentence} GROUP BY p.status`, [userId]);
  const [recent] = await this.db.pool.execute<RowDataPacket[]>(`SELECT e.id,e.title,e.sequence,c.title AS collectionTitle,
    s.id AS lastSentenceId,p.completed_at AS completedAt
    FROM el_episode_progress p JOIN el_episodes e ON e.id=p.episode_id JOIN el_collections c ON c.id=e.collection_id
    LEFT JOIN el_sentences s ON s.id=p.last_sentence_id AND s.episode_id=p.episode_id AND s.is_del=0
    WHERE p.user_id=? AND p.is_del=0 AND ${visibleEpisode} ORDER BY p.last_studied_at DESC,p.id DESC LIMIT 5`, [userId]);
  return { completedEpisodes: Number(completed[0].count),
   mastered: Number(counts.find(r => r.status === 2)?.count || 0),
   learning: Number(counts.find(r => r.status === 1)?.count || 0), recent };
 }
 async collection(userId: string, collectionId: string) {
  await this.catalog.collection(collectionId);
  const [items] = await this.db.pool.execute<RowDataPacket[]>(`SELECT p.episode_id AS id,p.completed_at AS completedAt
    FROM el_episode_progress p JOIN el_episodes e ON e.id=p.episode_id JOIN el_collections c ON c.id=e.collection_id
    WHERE p.user_id=? AND e.collection_id=? AND p.is_del=0 AND ${visibleEpisode}`, [userId, collectionId]);
  return { items };
 }
 async review(userId: string, offset: number, limit: number) {
  const from = `FROM el_sentence_progress p JOIN el_sentences s ON s.id=p.sentence_id
    JOIN el_episodes e ON e.id=s.episode_id JOIN el_collections c ON c.id=e.collection_id
    WHERE p.user_id=? AND p.status=1 AND p.is_del=0 AND ${visibleSentence}`;
  const [items] = await this.db.pool.query<RowDataPacket[]>(`SELECT s.id,s.zh,s.en,s.context,s.speaker,s.sequence,
    e.id AS episodeId,e.title AS episodeTitle,e.sequence AS episodeSequence,c.title AS collectionTitle
    ${from} ORDER BY c.sort_order,c.id,e.sequence,e.id,s.sequence,s.id LIMIT ? OFFSET ?`, [userId, limit, offset]);
  const [counts] = await this.db.pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total ${from}`, [userId]);
  return { items, total: Number(counts[0].total) };
 }
}
