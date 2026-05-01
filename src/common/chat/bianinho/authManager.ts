// ============================================================
// BianinhoAuthManager — Login + Admin Privileges
// ============================================================

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { getBianinhoPaths } from "./types";

const PBKDF2_ITERATIONS = 100_000;
const SALT_LEN = 32;
const KEY_LEN = 32;

export interface AdminUser {
  username: string;
  salt: string;       // base64
  hash: string;       // base64
  isAdmin: boolean;   // full admin (sudo)
  permissions: string[];
  createdAt: number;
  lastLogin: number;
}

export interface LoginResult {
  ok: boolean;
  error?: string;
  user?: { username: string; isAdmin: boolean; permissions: string[] };
}

export class BianinhoAuthManager {
  private usersPath: string;
  private users: Map<string, AdminUser> = new Map();
  private currentUser: AdminUser | null = null;

  constructor() {
    const paths = getBianinhoPaths();
    this.usersPath = path.join(paths.configPath || "", "bianinho_users.json");
    this.load();
  }

  // ── Password hashing ────────────────────────────────────

  private deriveKey(password: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LEN, "sha256");
  }

  private hashPassword(password: string): { salt: Buffer; hash: Buffer } {
    const salt = crypto.randomBytes(SALT_LEN);
    const hash = this.deriveKey(password, salt);
    return { salt, hash };
  }

  // ── Persistence ────────────────────────────────────────

  private save(): void {
    const data = Array.from(this.users.values());
    const dir = path.dirname(this.usersPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.usersPath, JSON.stringify(data, null, 2));
  }

  private load(): void {
    try {
      if (fs.existsSync(this.usersPath)) {
        const data: AdminUser[] = JSON.parse(fs.readFileSync(this.usersPath, "utf-8"));
        this.users = new Map(data.map((u) => [u.username, u]));
      } else {
        this.createDefaultUser();
      }
    } catch {
      this.createDefaultUser();
    }
  }

  private createDefaultUser(): void {
    // Default credentials — deve ser mudado na primeira utilização
    const { salt, hash } = this.hashPassword("bianinho2026");
    const defaultUser: AdminUser = {
      username: "admin",
      salt: salt.toString("base64"),
      hash: hash.toString("base64"),
      isAdmin: true,
      permissions: ["*"],  // wildcard = todas as permissões
      createdAt: Date.now(),
      lastLogin: 0,
    };
    this.users.set("admin", defaultUser);
    this.save();
    console.log("[AuthManager] Default admin user created — CHANGE PASSWORD ON FIRST LOGIN");
  }

  // ── Login ───────────────────────────────────────────────

  login(username: string, password: string): LoginResult {
    const user = this.users.get(username);
    if (!user) return { ok: false, error: "Utilizador não encontrado" };

    const salt = Buffer.from(user.salt, "base64");
    const hash = this.deriveKey(password, salt);

    if (!crypto.timingSafeEqual(hash, Buffer.from(user.hash, "base64"))) {
      return { ok: false, error: "Palavra-passe incorrecta" };
    }

    // Update last login
    user.lastLogin = Date.now();
    this.save();

    this.currentUser = user;
    return {
      ok: true,
      user: { username: user.username, isAdmin: user.isAdmin, permissions: user.permissions },
    };
  }

  logout(): void {
    this.currentUser = null;
  }

  // ── User management ─────────────────────────────────────

  createUser(
    username: string,
    password: string,
    isAdmin = false,
    permissions: string[] = []
  ): boolean {
    if (this.users.has(username)) return false;
    const { salt, hash } = this.hashPassword(password);
    const user: AdminUser = {
      username,
      salt: salt.toString("base64"),
      hash: hash.toString("base64"),
      isAdmin,
      permissions: isAdmin ? ["*"] : permissions,
      createdAt: Date.now(),
      lastLogin: 0,
    };
    this.users.set(username, user);
    this.save();
    return true;
  }

  changePassword(username: string, oldPassword: string, newPassword: string): LoginResult {
    const loginResult = this.login(username, oldPassword);
    if (!loginResult.ok) return loginResult;

    const user = this.users.get(username)!;
    const { salt, hash } = this.hashPassword(newPassword);
    user.salt = salt.toString("base64");
    user.hash = hash.toString("base64");
    this.save();
    return { ok: true, user: { username: user.username, isAdmin: user.isAdmin, permissions: user.permissions } };
  }

  // ── Permissions ─────────────────────────────────────────

  hasPermission(permission: string): boolean {
    if (!this.currentUser) return false;
    if (this.currentUser.isAdmin) return true;
    return this.currentUser.permissions.includes(permission) || this.currentUser.permissions.includes("*");
  }

  isAdmin(): boolean {
    return this.currentUser?.isAdmin ?? false;
  }

  getCurrentUser(): AdminUser | null {
    return this.currentUser;
  }
}
