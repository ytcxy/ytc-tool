// MySQL BIGINT IDs travel as decimal strings; never convert them to JS numbers.
export type DatabaseId = string;
export type Status='unseen'|'learning'|'mastered';
export interface Collection {id:DatabaseId;title:string;description:string;episodeCount:number}
export interface Episode {id:DatabaseId;title:string;sequence:number;sentenceCount:number;state?:string;collectionTitle?:string;collectionId?:DatabaseId;sourceUrl?:string|null}
export interface Sentence {id:DatabaseId;audioUrl?:string|null;sequence:number;speaker:0|1;zh:string;en:string;context:string;status:Status;revealed:boolean;episodeId?:DatabaseId;episodeTitle?:string;episodeSequence?:number;collectionTitle?:string}
export interface Profile {id:DatabaseId;nickname:string;avatarPath:string|null;avatarUrl?:string}
export interface Summary {completedEpisodes:number;mastered:number;learning:number;recent:Episode[]}
export interface EpisodeProgress {lastSentenceId:DatabaseId|null;completed:boolean;sentences:{id:DatabaseId;status:Status}[]}
