import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { createRefreshToken, hashToken, signAccessToken } from "../../utils/token.js";
import type {
  FeishuAuthorizeQuery,
  FeishuCallbackInput,
  LoginInput,
  RefreshInput,
  RegisterInput
} from "./auth.schema.js";

const REFRESH_TOKEN_DAYS = 30;
const FEISHU_API_ORIGIN = "https://open.feishu.cn";
const FEISHU_LOGIN_SCOPES = [
  "contact:user.email:readonly"
];

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

function isFeishuLoginConfigured() {
  return Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET);
}

function getFeishuRedirectUri() {
  return `${env.APP_BASE_URL}/auth/feishu/callback`;
}

function signFeishuState(redirectTo: string) {
  return jwt.sign({ redirectTo }, env.JWT_ACCESS_SECRET, { expiresIn: "10m" });
}

function verifyFeishuState(state: string) {
  try {
    const payload = jwt.verify(state, env.JWT_ACCESS_SECRET) as { redirectTo?: string };
    return payload.redirectTo && payload.redirectTo.startsWith("/") && !payload.redirectTo.startsWith("//")
      ? payload.redirectTo
      : "/dashboard";
  } catch {
    throw new AppError("UNAUTHORIZED", "Invalid Feishu login state", 401);
  }
}

async function requestFeishuAppAccessToken() {
  const response = await fetch(`${FEISHU_API_ORIGIN}/open-apis/auth/v3/app_access_token/internal`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      app_id: env.FEISHU_APP_ID,
      app_secret: env.FEISHU_APP_SECRET
    })
  });
  const data = await response.json() as {
    code?: number;
    msg?: string;
    app_access_token?: string;
  };

  if (!response.ok || data.code !== 0 || !data.app_access_token) {
    throw new AppError("BAD_GATEWAY", data.msg || "Feishu app token request failed", 502);
  }

  return data.app_access_token;
}

async function requestFeishuUserAccessToken(code: string) {
  const appAccessToken = await requestFeishuAppAccessToken();
  const response = await fetch(`${FEISHU_API_ORIGIN}/open-apis/authen/v1/access_token`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${appAccessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: getFeishuRedirectUri()
    })
  });
  const data = await response.json() as {
    code?: number;
    msg?: string;
    data?: {
      access_token?: string;
    };
  };

  if (!response.ok || data.code !== 0 || !data.data?.access_token) {
    throw new AppError("BAD_GATEWAY", data.msg || "Feishu user token request failed", 502);
  }

  return data.data.access_token;
}

async function requestFeishuUserInfo(code: string) {
  const userAccessToken = await requestFeishuUserAccessToken(code);
  const response = await fetch(`${FEISHU_API_ORIGIN}/open-apis/authen/v1/user_info`, {
    headers: {
      authorization: `Bearer ${userAccessToken}`
    }
  });
  const data = await response.json() as {
    code?: number;
    msg?: string;
    data?: {
      email?: string;
      name?: string;
      en_name?: string;
      open_id?: string;
      union_id?: string;
      avatar_url?: string;
      avatar_thumb?: string;
    };
  };

  if (!response.ok || data.code !== 0 || !data.data?.open_id) {
    throw new AppError("BAD_GATEWAY", data.msg || "Feishu user info request failed", 502);
  }

  return data.data;
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

export function getFeishuAuthorizeUrl(input: FeishuAuthorizeQuery) {
  if (!isFeishuLoginConfigured()) {
    return {
      configured: false,
      authorizeUrl: null
    };
  }

  const redirectUri = getFeishuRedirectUri();
  const authorizeUrl = new URL(`${FEISHU_API_ORIGIN}/open-apis/authen/v1/index`);
  authorizeUrl.searchParams.set("app_id", env.FEISHU_APP_ID!);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", signFeishuState(input.redirectTo));
  authorizeUrl.searchParams.set("scope", FEISHU_LOGIN_SCOPES.join(" "));

  return {
    configured: true,
    authorizeUrl: authorizeUrl.toString()
  };
}

export async function loginWithFeishu(input: FeishuCallbackInput) {
  if (!isFeishuLoginConfigured()) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Feishu login is not configured", 422);
  }

  const redirectTo = verifyFeishuState(input.state);
  const feishuUser = await requestFeishuUserInfo(input.code);
  const feishuEmail = feishuUser.email?.trim().toLowerCase() || null;
  const email = feishuEmail || `${feishuUser.open_id}@feishu.local`;

  const name = feishuUser.name || feishuUser.en_name || email.split("@")[0] || "飞书用户";
  const avatarUrl = feishuUser.avatar_url || feishuUser.avatar_thumb || null;
  const user = await prisma.$transaction(async (tx) => {
    const existingUser = await tx.user.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { email },
          { feishuOpenId: feishuUser.open_id },
          ...(feishuUser.union_id ? [{ feishuUnionId: feishuUser.union_id }] : [])
        ]
      }
    });

    if (existingUser) {
      try {
        return await tx.user.update({
          where: {
            id: existingUser.id
          },
          data: {
            email: existingUser.email || email,
            name: existingUser.name || name,
            avatarUrl: existingUser.avatarUrl ?? avatarUrl,
            feishuOpenId: feishuUser.open_id,
            feishuUnionId: feishuUser.union_id ?? null
          }
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new AppError("CONFLICT", "Feishu account is already bound to another user", 409);
        }

        throw error;
      }
    }

    return tx.user.create({
      data: {
        email,
        name,
        avatarUrl,
        feishuOpenId: feishuUser.open_id,
        feishuUnionId: feishuUser.union_id ?? null,
        emailVerifiedAt: feishuEmail ? new Date() : null
      }
    });
  });
  const tokens = await issueTokens(user.id);

  return {
    ...tokens,
    user: toPublicUser(user),
    redirectTo
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
