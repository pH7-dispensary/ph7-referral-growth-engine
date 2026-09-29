import "server-only";

/**
 * Deliberately driver-neutral boundary. Step 11.1 does not install a driver or
 * connect to a database; a future composition root supplies a Supabase/Postgres
 * implementation using parameterized queries and real transactions.
 */
export interface SqlResult<Row> {
  readonly rows: readonly Row[];
}

export interface SqlExecutor {
  query<Row>(statement: string, parameters?: readonly unknown[]): Promise<SqlResult<Row>>;
  transaction<T>(operation: (transaction: SqlExecutor) => Promise<T>): Promise<T>;
}

export interface AttributionEconomicsRecord {
  readonly campaignVersion: number;
  readonly programmeSettingsVersion: number;
  readonly friendIncentiveMinor: number;
  readonly referrerRewardMinor: number;
  readonly currency: "EUR";
  readonly qualificationEvent: string;
  readonly holdingPeriodDays: number;
  readonly rewardCapMinor: number | null;
}

export interface CreateAttributionRecord extends AttributionEconomicsRecord {
  /** Internal UUIDs only; never expose them to a browser. */
  readonly referralCodeId: string;
  readonly campaignId: string;
  /** Opaque attr_<32 lowercase hex> identifier generated before insertion. */
  readonly publicId: string;
  /** SHA-256 (or stronger) hash of the journey/code context, never raw context. */
  readonly journeyContextHash: string;
}

export interface StoredAttributionRecord extends AttributionEconomicsRecord {
  readonly id: string;
  readonly publicId: string;
  readonly journeyContextHash: string;
  readonly createdAt: Date;
}

interface AttributionRow {
  id: string;
  public_id: string;
  journey_context_hash: string;
  campaign_version: number;
  programme_settings_version: number;
  friend_incentive_minor: number;
  referrer_reward_minor: number;
  currency: "EUR";
  qualification_event: string;
  holding_period_days: number;
  reward_cap_minor: number | null;
  created_at: Date | string;
}

const attributionColumns = `
  id, public_id, journey_context_hash, campaign_version,
  programme_settings_version, friend_incentive_minor,
  referrer_reward_minor, currency, qualification_event,
  holding_period_days, reward_cap_minor, created_at`;

function mapAttribution(row: AttributionRow): StoredAttributionRecord {
  return Object.freeze({
    id: row.id, publicId: row.public_id, journeyContextHash: row.journey_context_hash,
    campaignVersion: row.campaign_version, programmeSettingsVersion: row.programme_settings_version,
    friendIncentiveMinor: row.friend_incentive_minor, referrerRewardMinor: row.referrer_reward_minor,
    currency: row.currency, qualificationEvent: row.qualification_event,
    holdingPeriodDays: row.holding_period_days, rewardCapMinor: row.reward_cap_minor,
    createdAt: new Date(row.created_at),
  });
}

/**
 * PostgreSQL implementation of the attribution persistence boundary. It is
 * executable only once a driver-backed SqlExecutor is injected in a later step.
 * The conflict target is a database constraint, so idempotency survives process
 * restarts and concurrent application instances.
 */
export class PostgresAttributionRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async findByPublicId(publicId: string): Promise<StoredAttributionRecord | null> {
    const result = await this.sql.query<AttributionRow>(
      `SELECT ${attributionColumns} FROM referral_attributions WHERE public_id = $1`, [publicId],
    );
    return result.rows[0] ? mapAttribution(result.rows[0]) : null;
  }

  async createOrResolve(input: CreateAttributionRecord): Promise<{ readonly attribution: StoredAttributionRecord; readonly created: boolean }> {
    return this.sql.transaction(async (transaction) => {
      const insert = await transaction.query<AttributionRow>(
        `INSERT INTO referral_attributions (
          referral_code_id, campaign_id, campaign_version, programme_settings_version,
          friend_incentive_minor, referrer_reward_minor, currency, qualification_event,
          holding_period_days, reward_cap_minor, public_id, journey_context_hash
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (journey_context_hash) DO NOTHING
        RETURNING ${attributionColumns}`,
        [input.referralCodeId, input.campaignId, input.campaignVersion, input.programmeSettingsVersion,
          input.friendIncentiveMinor, input.referrerRewardMinor, input.currency, input.qualificationEvent,
          input.holdingPeriodDays, input.rewardCapMinor, input.publicId, input.journeyContextHash],
      );
      if (insert.rows[0]) return { attribution: mapAttribution(insert.rows[0]), created: true };

      const existing = await transaction.query<AttributionRow>(
        `SELECT ${attributionColumns} FROM referral_attributions WHERE journey_context_hash = $1`,
        [input.journeyContextHash],
      );
      if (!existing.rows[0]) throw new Error("Attribution insert conflicted but no record could be read.");
      return { attribution: mapAttribution(existing.rows[0]), created: false };
    });
  }
}
