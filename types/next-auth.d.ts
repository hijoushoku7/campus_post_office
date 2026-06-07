import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "ADMIN" | "MEMBER";
    } & DefaultSession["user"];
  }

  interface User {
    role?: "ADMIN" | "MEMBER";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "ADMIN" | "MEMBER";
  }
}
