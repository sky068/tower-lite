import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { createRefreshToken, hashToken, signAccessToken } from "../../utils/token.js";
import type { LoginInput, RefreshInput, RegisterInput } from "./auth.schema.js";

const REFRESH_TOKEN_DAYS = 30;

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function toPublicUser(user: { id: string; email: string; name: string; avatarUrl: string | null }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl
  };
}

async function issueTokens(userId: string) {
  const refreshToken = createRefreshToken();

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(refreshToken),
      userId,
      expiresAt: daysFromNow(REFRESH_TOKEN_DAYS)
    }
  });

  return {
    accessToken: signAccessToken(userId),
    refreshToken
  };
}

export async function register(input: RegisterInput) {
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email }
  });

  if (existingUser) {
    throw new AppError("CONFLICT", "Email is already registered", 409);
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash
    }
  });

  const tokens = await issueTokens(user.id);

  return {
    ...tokens,
    user: toPublicUser(user)
  };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email }
  });

  if (!user?.passwordHash) {
    throw new AppError("UNAUTHORIZED", "Invalid email or password", 401);
  }

  const isValidPassword = await bcrypt.compare(input.password, user.passwordHash);

  if (!isValidPassword) {
    throw new AppError("UNAUTHORIZED", "Invalid email or password", 401);
  }

  const tokens = await issueTokens(user.id);

  return {
    ...tokens,
    user: toPublicUser(user)
  };
}

export async function refresh(input: RefreshInput) {
  const tokenHash = hashToken(input.refreshToken);
  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true }
  });

  if (!storedToken || storedToken.revokedAt || storedToken.expiresAt <= new Date()) {
    throw new AppError("UNAUTHORIZED", "Invalid refresh token", 401);
  }

  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: { revokedAt: new Date() }
  });

  const tokens = await issueTokens(storedToken.userId);

  return {
    ...tokens,
    user: toPublicUser(storedToken.user)
  };
}

export async function logout(input: RefreshInput) {
  await prisma.refreshToken.updateMany({
    where: {
      tokenHash: hashToken(input.refreshToken),
      revokedAt: null
    },
    data: {
      revokedAt: new Date()
    }
  });

  return { ok: true };
}
