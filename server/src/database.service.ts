import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPool } from 'mysql2';
import { Pool } from 'mysql2/promise';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(config: ConfigService) {
    const pool = createPool({
      host: config.getOrThrow<string>('DB_HOST'),
      port: config.getOrThrow<number>('DB_PORT'),
      user: config.getOrThrow<string>('DB_USER'),
      password: config.getOrThrow<string>('DB_PASSWORD'),
      database: config.getOrThrow<string>('DB_NAME'),
      charset: 'utf8mb4',
      supportBigNumbers: true,
      bigNumberStrings: true,
      timezone: 'Z',
      connectionLimit: 10,
      queueLimit: 20,
      connectTimeout: 5000,
      multipleStatements: false,
    });
    pool.on('connection', (connection) => {
      connection.query("SET time_zone = '+00:00'", (error: Error | null) => {
        if (error) connection.destroy();
      });
    });
    this.pool = pool.promise();
  }

  async ping(): Promise<void> {
    await this.pool.execute('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
