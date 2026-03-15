#!/usr/bin/env python3
"""AWS service name → seed URL mapping.

This can be run standalone to print all configured services,
or imported for the mapping dict.
"""

SEED_URLS: dict[str, str] = {
    "s3": "https://docs.aws.amazon.com/AmazonS3/latest/userguide/",
    "ec2": "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/",
    "lambda": "https://docs.aws.amazon.com/lambda/latest/dg/",
    "dynamodb": "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/",
    "rds": "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/",
    "vpc": "https://docs.aws.amazon.com/vpc/latest/userguide/",
    "eks": "https://docs.aws.amazon.com/eks/latest/userguide/",
    "ecs": "https://docs.aws.amazon.com/AmazonECS/latest/developerguide/",
    "iam": "https://docs.aws.amazon.com/IAM/latest/UserGuide/",
    "sqs": "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/",
    "sns": "https://docs.aws.amazon.com/sns/latest/dg/",
    "cloudwatch": "https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/",
    "cloudformation": "https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/",
    "route53": "https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/",
    "elasticache": "https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/",
    "kinesis": "https://docs.aws.amazon.com/streams/latest/dev/",
    "redshift": "https://docs.aws.amazon.com/redshift/latest/dg/",
    "emr": "https://docs.aws.amazon.com/emr/latest/ManagementGuide/",
    "glue": "https://docs.aws.amazon.com/glue/latest/dg/",
    "stepfunctions": "https://docs.aws.amazon.com/step-functions/latest/dg/",
}


if __name__ == "__main__":
    print(f"Configured {len(SEED_URLS)} AWS services:\n")
    for name, url in sorted(SEED_URLS.items()):
        print(f"  {name:20s} {url}")
