import bcrypt from "bcryptjs";
import { getPool } from "../_shared/client.js";
import { AUTH_LIMITS } from "../../services/auth/authConstants.js";

export type PublicUser = {
  id: number;
  email: string;
  name: string;
  organization: string;
  role: string;
  createdAt: string;
  updatedAt: string;
};

type UserRow = {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  organization: string;
  role: string;
  created_at: Date;
  updated_at: Date;
};

const toPublic = (row: UserRow): PublicUser => ({
  id: Number(row.id),
  email: row.email,
  name: row.name,
  organization: row.organization,
  role: row.role,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const hashPassword = (password: string) =>
  bcrypt.hash(password, AUTH_LIMITS.BCRYPT_ROUNDS);

export const verifyPassword = (password: string, stored: string) =>
  bcrypt.compare(password, stored);

export const findUserByEmail = async (email: string): Promise<UserRow | null> => {
  const { rows } = await getPool().query<UserRow>(
    `
      SELECT id, email, password_hash, name, organization, role, created_at, updated_at
      FROM users
      WHERE lower(email) = lower($1)
      LIMIT 1
    `,
    [normalizeEmail(email)],
  );
  return rows[0] ?? null;
};

export const findUserById = async (id: number): Promise<UserRow | null> => {
  const { rows } = await getPool().query<UserRow>(
    `
      SELECT id, email, password_hash, name, organization, role, created_at, updated_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  );
  return rows[0] ?? null;
};

export const countUsers = async () => {
  const { rows } = await getPool().query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM users`);
  return Number(rows[0]?.count ?? 0);
};

export const createUser = async (input: {
  email: string;
  password: string;
  name: string;
  organization?: string;
  role?: string;
}): Promise<PublicUser> => {
  const passwordHash = await hashPassword(input.password);
  const { rows } = await getPool().query<UserRow>(
    `
      INSERT INTO users (email, password_hash, name, organization, role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, password_hash, name, organization, role, created_at, updated_at
    `,
    [
      normalizeEmail(input.email),
      passwordHash,
      input.name.trim(),
      input.organization?.trim() || "ExtractIQ",
      input.role?.trim() || "Document reviewer",
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("User was not created.");
  return toPublic(row);
};

export const updateUserPasswordHash = async (userId: number, passwordHash: string) => {
  await getPool().query(
    `
      UPDATE users
      SET password_hash = $2, updated_at = NOW()
      WHERE id = $1
    `,
    [userId, passwordHash],
  );
};

export const updateUserProfile = async (
  userId: number,
  input: { name: string; email: string; organization: string; role: string },
): Promise<PublicUser | null> => {
  const { rows } = await getPool().query<UserRow>(
    `
      UPDATE users
      SET name = $2,
          email = $3,
          organization = $4,
          role = $5,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, email, password_hash, name, organization, role, created_at, updated_at
    `,
    [
      userId,
      input.name.trim(),
      normalizeEmail(input.email),
      input.organization.trim() || "ExtractIQ",
      input.role.trim() || "Document reviewer",
    ],
  );
  return rows[0] ? toPublic(rows[0]) : null;
};

export const publicUserFromRow = toPublic;
