/**
 * The 20 seeded AWS service ids (mirrors scripts/seed_services.py).
 * Used to populate the service-filter chips in the left rail. These are the
 * known services; the request still accepts any subset via `services[]`.
 */
export const SERVICE_IDS = [
  "s3",
  "ec2",
  "lambda",
  "dynamodb",
  "rds",
  "vpc",
  "eks",
  "ecs",
  "iam",
  "sqs",
  "sns",
  "cloudwatch",
  "cloudformation",
  "route53",
  "elasticache",
  "kinesis",
  "redshift",
  "emr",
  "glue",
  "stepfunctions",
] as const;

export type ServiceId = (typeof SERVICE_IDS)[number];
