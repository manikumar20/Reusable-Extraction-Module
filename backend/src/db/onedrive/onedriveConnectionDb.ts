import { getPool } from "../_shared/client.js";

export type OneDriveConnectionRow = {
  user_id: number;
  account_email: string;
  account_name: string;
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  scope: string;
};

export const getOneDriveConnection = async (userId: number) => {
  const result = await getPool().query<OneDriveConnectionRow>(
    `SELECT user_id, account_email, account_name, access_token, refresh_token, expires_at, scope
     FROM onedrive_connections
     WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0] || null;
};

export const upsertOneDriveConnection = async (input: {
  userId: number;
  accountEmail: string;
  accountName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
}) => {
  await getPool().query(
    `INSERT INTO onedrive_connections (
       user_id, account_email, account_name, access_token, refresh_token, expires_at, scope, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       account_email = EXCLUDED.account_email,
       account_name = EXCLUDED.account_name,
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(NULLIF(EXCLUDED.refresh_token, ''), onedrive_connections.refresh_token),
       expires_at = EXCLUDED.expires_at,
       scope = EXCLUDED.scope,
       updated_at = NOW()`,
    [
      input.userId,
      input.accountEmail,
      input.accountName,
      input.accessToken,
      input.refreshToken,
      input.expiresAt,
      input.scope,
    ],
  );
};

export const deleteOneDriveConnection = async (userId: number) => {
  await getPool().query(`DELETE FROM onedrive_connections WHERE user_id = $1`, [userId]);
};
