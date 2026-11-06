
import "dotenv/config";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({
  region: process.env.AWS_REGION,
});

export const dynamoDB = DynamoDBDocumentClient.from(client);

export const TABLE_NAME = process.env.DYNAMODB_TABLE;
