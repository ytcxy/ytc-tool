import { Injectable, NotFoundException } from '@nestjs/common';
import { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database.service';
// These predicates use fixed SQL aliases, never user-controlled input.
export const visibleCollection = 'c.is_del=0 AND c.status=1';
export const visibleEpisode = `e.is_del=0 AND e.status=1 AND ${visibleCollection}`;
export const visibleSentence = `s.is_del=0 AND ${visibleEpisode}`;
@Injectable()
export class CatalogService {
 constructor(private readonly db: DatabaseService) {}
 async collections(offset: number, limit: number) {
  const [items] = await this.db.pool.query<RowDataPacket[]>(`SELECT c.id,c.title,c.description,
    (SELECT COUNT(*) FROM el_episodes e WHERE e.collection_id=c.id AND e.is_del=0 AND e.status=1) AS episodeCount
    FROM el_collections c WHERE ${visibleCollection} ORDER BY c.sort_order,c.id LIMIT ? OFFSET ?`, [limit, offset]);
  const [total] = await this.db.pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM el_collections c WHERE ${visibleCollection}`);
  return { items: items.map(item => ({ ...item, episodeCount: Number(item.episodeCount) })), total: Number(total[0].total) };
 }
 async collection(collectionId: string) {
  const [rows] = await this.db.pool.execute<RowDataPacket[]>(
   `SELECT c.id,c.title,c.description FROM el_collections c WHERE c.id=? AND ${visibleCollection}`, [collectionId]);
  if (!rows.length) throw new NotFoundException('合集不存在或尚未发布');
  return rows[0];
 }
 async episodes(collectionId: string, offset: number, limit: number) {
  const collection = await this.collection(collectionId);
  const from = `FROM el_episodes e JOIN el_collections c ON c.id=e.collection_id
    WHERE e.collection_id=? AND ${visibleEpisode}`;
  const [items] = await this.db.pool.query<RowDataPacket[]>(`SELECT e.id,e.title,e.sequence,
    (SELECT COUNT(*) FROM el_sentences s WHERE s.episode_id=e.id AND s.is_del=0) AS sentenceCount
    ${from} ORDER BY e.sequence,e.id LIMIT ? OFFSET ?`, [collectionId, limit, offset]);
  const [total] = await this.db.pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total ${from}`, [collectionId]);
  return { collection, items: items.map(item => ({ ...item, sentenceCount: Number(item.sentenceCount) })), total: Number(total[0].total) };
 }
 async episode(episodeId: string) {
  const [rows] = await this.db.pool.execute<RowDataPacket[]>(`SELECT e.id,e.title,e.sequence,
    e.collection_id AS collectionId,c.title AS collectionTitle,e.source_url AS sourceUrl
    FROM el_episodes e JOIN el_collections c ON c.id=e.collection_id
    WHERE e.id=? AND ${visibleEpisode}`, [episodeId]);
  if (!rows.length) throw new NotFoundException('单集不存在或尚未发布');
  return rows[0];
 }
 async sentences(episodeId: string) {
  await this.episode(episodeId);
  const [items] = await this.db.pool.execute<RowDataPacket[]>(`SELECT s.id,s.sequence,s.zh,s.en,s.context,s.speaker
    FROM el_sentences s JOIN el_episodes e ON e.id=s.episode_id JOIN el_collections c ON c.id=e.collection_id
    WHERE s.episode_id=? AND ${visibleSentence} ORDER BY s.sequence,s.id LIMIT 200`, [episodeId]);
  return { items };
 }
 async sentence(sentenceId: string) {
  const [rows] = await this.db.pool.execute<RowDataPacket[]>(`SELECT s.id,s.episode_id AS episodeId
    FROM el_sentences s JOIN el_episodes e ON e.id=s.episode_id JOIN el_collections c ON c.id=e.collection_id
    WHERE s.id=? AND ${visibleSentence}`, [sentenceId]);
  if (!rows.length) throw new NotFoundException('条目不存在或尚未发布');
  return rows[0];
 }
}
