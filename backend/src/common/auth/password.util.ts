import * as argon2 from '@node-rs/argon2';
import * as bcrypt from 'bcrypt';

// Lazy password migration from Zammad's Argon2id to SolidOps bcrypt.
//
// Zammad hashes passwords with Argon2id, which bcrypt cannot verify. When a
// migrated user logs in:
//  - If a bcrypt `hash` exists, verify with bcrypt (normal path).
//  - If not, but a `legacyArgon2Hash` exists, verify with Argon2id. On success,
//    persist a fresh bcrypt hash via `onMigrate` and clear the legacy hash.
//  - Otherwise (both null / legacy fails) -> login fails (no signal about which).
//
// Returns true when the password is valid.
export async function verifyPasswordLazy(params: {
  password: string;
  bcryptHash: string | null | undefined;
  legacyArgon2Hash: string | null | undefined;
  // Zammad hashes passwords with Argon2id + its application_secret (a "pepper").
  // Without it the hash decodes but no real password matches, so any migrated
  // user would always get a 401. Pass the secret from Zammad when migrating.
  zammadSecret?: string | null;
  onMigrate: (newBcryptHash: string) => Promise<void>;
}): Promise<boolean> {
  if (params.bcryptHash) {
    try {
      const ok = await bcrypt.compare(params.password, params.bcryptHash);
      return ok;
    } catch {
      return false;
    }
  }

  if (params.legacyArgon2Hash) {
    try {
      // Mirrors Zammad's lib/password_hash.rb: verified?(hash, pw, secret).
      const ok = params.zammadSecret
        ? await argon2.verify(params.legacyArgon2Hash, params.password, {
            secret: Buffer.from(params.zammadSecret, 'utf8'),
          })
        : await argon2.verify(params.legacyArgon2Hash, params.password);
      if (!ok) return false;
      // On first correct login: re-hash with bcrypt and clear the legacy hash.
      const newBcrypt = await bcrypt.hash(params.password, 10);
      await params.onMigrate(newBcrypt);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
