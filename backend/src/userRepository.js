import { randomUUID, createHash } from "node:crypto";
import { ScanCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "./dynamodb.js";

const USER_RECORD_TYPE = "USER";

function generateUserPartitionKey(email, attempt = 0) {
  const hash = createHash("sha256")
    .update(`${email}:${attempt}`)
    .digest();

  return hash.readUIntBE(0, 6) + 1;
}

async function scanUsers(filterExpression, expressionValues, expressionNames = {}) {
  const users = [];
  let lastEvaluatedKey;

  do {
    const result = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: filterExpression,
        ExpressionAttributeValues: expressionValues,
        ...(Object.keys(expressionNames).length > 0
          ? { ExpressionAttributeNames: expressionNames }
          : {}),
        ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {})
      })
    );

    users.push(...(result.Items || []));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return users;
}

export async function findUserByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;

  const users = await scanUsers(
    "#recordType = :userType AND #email = :email",
    { ":userType": USER_RECORD_TYPE, ":email": normalizedEmail },
    { "#recordType": "recordType", "#email": "email" }
  );

  return users[0] || null;
}

export async function findUserByUserId(userId) {
  if (!userId) return null;

  const users = await scanUsers(
    "#recordType = :userType AND #userId = :userId",
    { ":userType": USER_RECORD_TYPE, ":userId": userId },
    { "#recordType": "recordType", "#userId": "userId" }
  );

  return users[0] || null;
}

export async function findActiveStaff(excludedUserId = "") {
  const users = await scanUsers(
    "#recordType = :userType AND #isActive = :active AND (#role = :admin OR #role = :support)",
    {
      ":userType": USER_RECORD_TYPE,
      ":active": 1,
      ":admin": "ADMIN",
      ":support": "SUPPORT_ENGINEER"
    },
    {
      "#recordType": "recordType",
      "#isActive": "is_active",
      "#role": "role"
    }
  );

  return users.filter((user) => user.userId !== excludedUserId);
}

export async function findActiveSupportEngineer(email) {
  const user = await findUserByEmail(email);

  if (
    !user ||
    user.role !== "SUPPORT_ENGINEER" ||
    Number(user.is_active) !== 1
  ) {
    return null;
  }

  return user;
}

export async function createUser({
  name,
  email,
  passwordHash,
  role = "EMPLOYEE"
}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!name || !normalizedEmail || !passwordHash) {
    throw new Error("Name, email and password hash are required.");
  }

  const allowedRoles = ["ADMIN", "SUPPORT_ENGINEER", "EMPLOYEE"];
  if (!allowedRoles.includes(role)) {
    throw new Error("Invalid user role.");
  }

  const existingUser = await findUserByEmail(normalizedEmail);
  if (existingUser) {
    const error = new Error("An account with this email already exists");
    error.code = "USER_EMAIL_EXISTS";
    throw error;
  }

  const userId = randomUUID();
  const maxAttempts = 100;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const item = {
      id: generateUserPartitionKey(normalizedEmail, attempt),
      recordType: USER_RECORD_TYPE,
      userId,
      sourceId: userId,
      name: name.trim(),
      email: normalizedEmail,
      password_hash: passwordHash,
      role,
      is_active: 1,
      created_at: new Date().toISOString()
    };

    try {
      await dynamoDB.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
          ConditionExpression: "attribute_not_exists(id)"
        })
      );

      return item;
    } catch (error) {
      if (error.name === "ConditionalCheckFailedException") {
        // Check whether a concurrent request registered the same email.
        const duplicate = await findUserByEmail(normalizedEmail);
        if (duplicate) {
          const duplicateError = new Error(
            "An account with this email already exists"
          );
          duplicateError.code = "USER_EMAIL_EXISTS";
          throw duplicateError;
        }
        continue;
      }

      throw error;
    }
  }

  const error = new Error("Unable to allocate a unique DynamoDB user ID.");
  error.code = "USER_ID_ALLOCATION_FAILED";
  throw error;
}

export function toPublicUser(user) {
  if (!user) return null;

  return {
    id: user.userId,
    name: user.name,
    email: user.email,
    role: user.role,
    is_active: Number(user.is_active),
    created_at: user.created_at
  };
}
