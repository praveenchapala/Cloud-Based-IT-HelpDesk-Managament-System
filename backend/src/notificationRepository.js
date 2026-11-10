import { createHash, randomUUID } from "node:crypto";
import {
  ScanCommand,
  PutCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "./dynamodb.js";

const RECORD_TYPE = "NOTIFICATION";
const MAX_ID_ATTEMPTS = 100;
const WRITE_DELAY_MS = Number(process.env.DYNAMODB_NOTIFICATION_WRITE_DELAY_MS ?? 0);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateNumericId(notificationId, attempt = 0) {
  const hash = createHash("sha256")
    .update(`${notificationId}:${attempt}`)
    .digest();

  return hash.readUIntBE(0, 6) + 1;
}

async function scanNotifications(userId) {
  const notifications = [];
  let lastEvaluatedKey;

  do {
    const result = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "#recordType = :recordType AND #userId = :userId",
        ExpressionAttributeNames: {
          "#recordType": "recordType",
          "#userId": "userId"
        },
        ExpressionAttributeValues: {
          ":recordType": RECORD_TYPE,
          ":userId": userId
        },
        ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {})
      })
    );

    notifications.push(...(result.Items || []));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return notifications;
}

function toPublicNotification(notification) {
  return {
    id: notification.notificationId,
    ticketId: notification.ticketId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    isRead: Number(notification.is_read) === 1,
    createdAt: notification.created_at
  };
}

export async function createNotification({
  userId,
  ticketId,
  type,
  title,
  message
}) {
  if (!userId || ticketId === undefined || ticketId === null) return null;

  const notificationId = randomUUID();
  const normalizedTicketId =
    Number.isSafeInteger(Number(ticketId)) && String(ticketId).trim() !== ""
      ? Number(ticketId)
      : String(ticketId);

  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
    const item = {
      id: generateNumericId(notificationId, attempt),
      recordType: RECORD_TYPE,
      notificationId,
      sourceId: notificationId,
      userId,
      ticketId: normalizedTicketId,
      type,
      title,
      message,
      is_read: 0,
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

      return toPublicNotification(item);
    } catch (error) {
      if (error.name === "ConditionalCheckFailedException") {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Unable to allocate a unique DynamoDB notification ID.");
}

export async function getNotificationsByUserId(userId) {
  const notifications = await scanNotifications(userId);

  notifications.sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at))
  );

  const latestNotifications = notifications.slice(0, 100);

  return {
    notifications: latestNotifications.map(toPublicNotification),
    unreadCount: notifications.filter(
      (notification) => Number(notification.is_read) === 0
    ).length
  };
}

export async function markNotificationAsRead(notificationId, userId) {
  const notifications = await scanNotifications(userId);
  const notification = notifications.find(
    (item) => item.notificationId === notificationId
  );

  if (!notification) return false;

  await dynamoDB.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: notification.id },
      UpdateExpression: "SET #isRead = :read",
      ConditionExpression:
        "#userId = :userId AND #recordType = :recordType",
      ExpressionAttributeNames: {
        "#isRead": "is_read",
        "#userId": "userId",
        "#recordType": "recordType"
      },
      ExpressionAttributeValues: {
        ":read": 1,
        ":userId": userId,
        ":recordType": RECORD_TYPE
      }
    })
  );

  return true;
}

export async function markAllNotificationsAsRead(userId) {
  const notifications = await scanNotifications(userId);
  const unread = notifications.filter(
    (notification) => Number(notification.is_read) === 0
  );

  let updatedCount = 0;

  for (const notification of unread) {
    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: notification.id },
        UpdateExpression: "SET #isRead = :read",
        ConditionExpression:
          "#userId = :userId AND #recordType = :recordType",
        ExpressionAttributeNames: {
          "#isRead": "is_read",
          "#userId": "userId",
          "#recordType": "recordType"
        },
        ExpressionAttributeValues: {
          ":read": 1,
          ":userId": userId,
          ":recordType": RECORD_TYPE
        }
      })
    );

    updatedCount++;

    if (WRITE_DELAY_MS > 0 && updatedCount < unread.length) {
      await sleep(WRITE_DELAY_MS);
    }
  }

  return updatedCount;
}
