import { PrismaClient, Role } from "@prisma/client";
import { hash } from "@node-rs/argon2";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "SEED_ADMIN_EMAIL と SEED_ADMIN_PASSWORD を .env に設定してください",
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`管理者は既に存在します: ${email}`);
    return;
  }

  const passwordHash = await hash(password);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: Role.ADMIN,
      isActive: true,
    },
  });
  console.log(`初期管理者を作成しました: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
