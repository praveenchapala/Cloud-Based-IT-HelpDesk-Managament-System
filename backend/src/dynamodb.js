import "dotenv/config";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
export const TABLE_NAME = process.env.DYNAMODB_TABLE;

if (!region) {
  throw new Error("AWS_REGION (or AWS_DEFAULT_REGION) must be configured.");
}

if (!TABLE_NAME) {
  throw new Error("DYNAMODB_TABLE must be configured.");
}

const client = new DynamoDBClient({ region });

export const dynamoDB = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});
