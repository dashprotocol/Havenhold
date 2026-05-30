DELETE FROM "Account" WHERE "userId" IN (SELECT id FROM "User" WHERE email IN ('david@example.com','sarah@example.com','michael@example.com'));
DELETE FROM "Session" WHERE "userId" IN (SELECT id FROM "User" WHERE email IN ('david@example.com','sarah@example.com','michael@example.com'));
DELETE FROM "PatientMember" WHERE "userId" IN (SELECT id FROM "User" WHERE email IN ('david@example.com','sarah@example.com','michael@example.com'));
DELETE FROM "User" WHERE email IN ('david@example.com','sarah@example.com','michael@example.com');
