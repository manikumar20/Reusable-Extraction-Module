import {
  countUsers,
  createUser,
  findUserByEmail,
  hashPassword,
  updateUserPasswordHash,
} from "../../db/users/userDb.js";

export const DEFAULT_USER_EMAIL = "alex@extractiq.app";
export const DEFAULT_USER_PASSWORD = "extractiq";

const isBcryptHash = (value: string) => value.startsWith("$2a$") || value.startsWith("$2b$") || value.startsWith("$2y$");

/** Seed a demo login when empty, and migrate legacy scrypt hashes to bcrypt. */
export const ensureDefaultUser = async () => {
  const total = await countUsers();
  if (total === 0) {
    const user = await createUser({
      email: DEFAULT_USER_EMAIL,
      password: DEFAULT_USER_PASSWORD,
      name: "Alex Chen",
      organization: "ExtractIQ",
      role: "Document reviewer",
    });
    console.log(`Created default user “${user.email}” (password: ${DEFAULT_USER_PASSWORD}).`);
    return user;
  }

  const existing = await findUserByEmail(DEFAULT_USER_EMAIL);
  if (existing && !isBcryptHash(existing.password_hash)) {
    await updateUserPasswordHash(existing.id, await hashPassword(DEFAULT_USER_PASSWORD));
    console.log(`Migrated default user “${existing.email}” password hash to bcrypt.`);
  }

  return null;
};
