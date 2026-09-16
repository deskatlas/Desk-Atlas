import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  PASSWORD_MIN_LENGTH,
  UPPERCASE_REGEX,
  DIGIT_REGEX,
  SPECIAL_CHAR_REGEX,
  DEFAULT_STAFF_PASSWORD,
  PasswordPolicyError,
  validatePassword,
  assertValidPassword,
  createStaffManagementService,
  StaffManagementMemoryRepository,
  StaffManagementError,
} from "@deskatlas/domain";

describe("MF-46: Password Policy Enforcement (PRD-F13)", () => {
  describe("Password Validator Unit Tests", () => {
    it("accepts valid passwords meeting all criteria", () => {
      const validPasswords = [
        "DeskAtlas123!",
        "P@ssw0rd2026",
        "Valid1#Pass",
        "SuperSecure99$",
        "A1!aaaaa", // exactly 8 chars, meets min requirements
        "Z0#zzzzz", // exactly 8 chars
        "Testing-123",
        "My_P@ssw0rd!",
      ];

      for (const pw of validPasswords) {
        const result = validatePassword(pw);
        assert.equal(result.isValid, true, `Expected "${pw}" to be valid`);
        assert.equal(result.minLength, true);
        assert.equal(result.hasUppercase, true);
        assert.equal(result.hasNumber, true);
        assert.equal(result.hasSpecialChar, true);
        assert.equal(result.errors.length, 0);
        assert.doesNotThrow(() => assertValidPassword(pw));
      }
    });

    it("verifies DEFAULT_STAFF_PASSWORD conforms to policy", () => {
      const result = validatePassword(DEFAULT_STAFF_PASSWORD);
      assert.equal(result.isValid, true);
      assert.doesNotThrow(() => assertValidPassword(DEFAULT_STAFF_PASSWORD));
    });

    it("rejects passwords shorter than 8 characters", () => {
      const shortPasswords = [
        "",
        "A1!",
        "Pass1!",
        "Aa1!Bb", // 6 chars
        "Aa1!Bb7", // 7 chars
      ];

      for (const pw of shortPasswords) {
        const result = validatePassword(pw);
        assert.equal(result.isValid, false, `Expected "${pw}" to be rejected for length`);
        assert.equal(result.minLength, false);
        assert.ok(result.errors.some((e) => e.includes("at least 8 characters")));
        assert.throws(() => assertValidPassword(pw), PasswordPolicyError);
      }
    });

    it("rejects passwords missing an uppercase letter", () => {
      const noUpperPasswords = [
        "lowercase123!",
        "desk_atlas99$",
        "p@ssw0rd",
        "alllowercase1!",
      ];

      for (const pw of noUpperPasswords) {
        const result = validatePassword(pw);
        assert.equal(result.isValid, false, `Expected "${pw}" to fail for uppercase`);
        assert.equal(result.hasUppercase, false);
        assert.ok(result.errors.some((e) => e.includes("uppercase letter")));
        assert.throws(() => assertValidPassword(pw), PasswordPolicyError);
      }
    });

    it("rejects passwords missing a number / digit", () => {
      const noDigitPasswords = [
        "DeskAtlas!@#",
        "NoDigitsHere!",
        "SuperSecret!",
        "A!aaaaaa", // 8 chars, upper + special, no digit
      ];

      for (const pw of noDigitPasswords) {
        const result = validatePassword(pw);
        assert.equal(result.isValid, false, `Expected "${pw}" to fail for digit`);
        assert.equal(result.hasNumber, false);
        assert.ok(result.errors.some((e) => e.includes("number")));
        assert.throws(() => assertValidPassword(pw), PasswordPolicyError);
      }
    });

    it("rejects passwords missing a special character", () => {
      const noSpecialPasswords = [
        "DeskAtlas123",
        "NoSpecialChars99",
        "Password1234",
        "A1aaaaaa", // 8 chars, upper + digit, no special
      ];

      for (const pw of noSpecialPasswords) {
        const result = validatePassword(pw);
        assert.equal(result.isValid, false, `Expected "${pw}" to fail for special character`);
        assert.equal(result.hasSpecialChar, false);
        assert.ok(result.errors.some((e) => e.includes("special character")));
        assert.throws(() => assertValidPassword(pw), PasswordPolicyError);
      }
    });

    it("rejects null and undefined passwords gracefully", () => {
      const nullResult = validatePassword(null);
      assert.equal(nullResult.isValid, false);
      assert.equal(nullResult.minLength, false);
      assert.equal(nullResult.hasUppercase, false);
      assert.equal(nullResult.hasNumber, false);
      assert.equal(nullResult.hasSpecialChar, false);
      assert.equal(nullResult.errors.length, 4);

      const undefinedResult = validatePassword(undefined);
      assert.equal(undefinedResult.isValid, false);
      assert.throws(() => assertValidPassword(null), PasswordPolicyError);
      assert.throws(() => assertValidPassword(undefined), PasswordPolicyError);
    });

    it("returns detailed rule breakdown for UI checklist", () => {
      const result = validatePassword("Pass1"); // 5 chars: uppercase=true, digit=true, special=false, length=false
      assert.equal(result.rules.length, 4);

      const minLengthRule = result.rules.find((r) => r.id === "minLength");
      assert.ok(minLengthRule);
      assert.equal(minLengthRule.passed, false);

      const upperRule = result.rules.find((r) => r.id === "hasUppercase");
      assert.ok(upperRule);
      assert.equal(upperRule.passed, true);

      const numRule = result.rules.find((r) => r.id === "hasNumber");
      assert.ok(numRule);
      assert.equal(numRule.passed, true);

      const specialRule = result.rules.find((r) => r.id === "hasSpecialChar");
      assert.ok(specialRule);
      assert.equal(specialRule.passed, false);
    });
  });

  describe("StaffManagementService Password Policy Integration", () => {
    const nowProvider = () => new Date("2026-09-08T12:00:00Z");
    const adminActor = { userId: "admin-root", role: "ADMIN" as const };

    it("allows creating staff with a strong password", async () => {
      const repo = new StaffManagementMemoryRepository([], nowProvider);
      const service = createStaffManagementService(repo, nowProvider);

      const staff = await service.createStaff({
        email: "secure.staff@deskatlas.com",
        displayName: "Secure Staff",
        password: "SuperSecret123!",
        role: "STAFF",
        actorUserId: adminActor.userId,
        actorRole: adminActor.role,
      });

      assert.equal(staff.email, "secure.staff@deskatlas.com");
      assert.equal(staff.isActive, true);
    });

    it("rejects creating staff with weak passwords", async () => {
      const repo = new StaffManagementMemoryRepository([], nowProvider);
      const service = createStaffManagementService(repo, nowProvider);

      // Short password
      await assert.rejects(
        () =>
          service.createStaff({
            email: "weak1@deskatlas.com",
            displayName: "Weak One",
            password: "Aa1!",
            role: "STAFF",
            actorUserId: adminActor.userId,
            actorRole: adminActor.role,
          }),
        (err: any) => err instanceof StaffManagementError && err.message.includes("at least 8 characters")
      );

      // Missing uppercase
      await assert.rejects(
        () =>
          service.createStaff({
            email: "weak2@deskatlas.com",
            displayName: "Weak Two",
            password: "weakpassword123!",
            role: "STAFF",
            actorUserId: adminActor.userId,
            actorRole: adminActor.role,
          }),
        (err: any) => err instanceof StaffManagementError && err.message.includes("uppercase letter")
      );

      // Missing number
      await assert.rejects(
        () =>
          service.createStaff({
            email: "weak3@deskatlas.com",
            displayName: "Weak Three",
            password: "NoNumbersInThis!",
            role: "STAFF",
            actorUserId: adminActor.userId,
            actorRole: adminActor.role,
          }),
        (err: any) => err instanceof StaffManagementError && err.message.includes("number")
      );

      // Missing special character
      await assert.rejects(
        () =>
          service.createStaff({
            email: "weak4@deskatlas.com",
            displayName: "Weak Four",
            password: "NoSpecialCharacter123",
            role: "STAFF",
            actorUserId: adminActor.userId,
            actorRole: adminActor.role,
          }),
        (err: any) => err instanceof StaffManagementError && err.message.includes("special character")
      );
    });

    it("allows updating staff password to a strong password", async () => {
      const repo = new StaffManagementMemoryRepository([], nowProvider);
      const service = createStaffManagementService(repo, nowProvider);

      const staff = await service.createStaff({
        email: "staff.update@deskatlas.com",
        displayName: "Staff Update",
        password: "InitialPassword123!",
        role: "STAFF",
        actorUserId: adminActor.userId,
        actorRole: adminActor.role,
      });

      const updated = await service.updateStaff({
        staffUserId: staff.id,
        password: "NewStrongPassword456$",
        actorUserId: adminActor.userId,
        actorRole: adminActor.role,
      });

      assert.equal(updated.id, staff.id);
    });

    it("rejects updating staff password to a weak password", async () => {
      const repo = new StaffManagementMemoryRepository([], nowProvider);
      const service = createStaffManagementService(repo, nowProvider);

      const staff = await service.createStaff({
        email: "staff.weakupdate@deskatlas.com",
        displayName: "Staff Weak Update",
        password: "InitialPassword123!",
        role: "STAFF",
        actorUserId: adminActor.userId,
        actorRole: adminActor.role,
      });

      await assert.rejects(
        () =>
          service.updateStaff({
            staffUserId: staff.id,
            password: "short",
            actorUserId: adminActor.userId,
            actorRole: adminActor.role,
          }),
        (err: any) => err instanceof StaffManagementError && err.message.includes("security requirements")
      );
    });
  });
});
