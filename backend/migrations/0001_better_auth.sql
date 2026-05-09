create table if not exists "user" (
  "id" text primary key not null,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" boolean not null,
  "image" text,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null
);

create table if not exists "session" (
  "id" text primary key not null,
  "expiresAt" timestamptz not null,
  "token" text not null unique,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);

create index if not exists "session_userId_idx" on "session" ("userId");

create table if not exists "account" (
  "id" text primary key not null,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null
);

create index if not exists "account_userId_idx" on "account" ("userId");

create table if not exists "verification" (
  "id" text primary key not null,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null
);

create index if not exists "verification_identifier_idx" on "verification" ("identifier");
