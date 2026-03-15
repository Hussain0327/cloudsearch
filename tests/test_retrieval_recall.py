"""Retrieval recall test set for BGE embeddings on AWS documentation chunks.

Verifies that semantic search over embedded chunks returns relevant results
in the top-5 for a variety of query types.
"""

from __future__ import annotations

import numpy as np
import pytest

# ---------------------------------------------------------------------------
# Realistic AWS documentation chunks
# ---------------------------------------------------------------------------

CHUNKS = [
    # 0 - S3 bucket policy
    (
        "[S3 > Bucket Policies] An S3 bucket policy is a resource-based policy "
        "that you can use to grant access permissions to your Amazon S3 bucket and "
        "the objects in it. Only the bucket owner can associate a policy with a bucket. "
        "Bucket policies supplement and in many cases replace ACL-based access policies."
    ),
    # 1 - IAM policy basics
    (
        "[IAM > Policies] IAM policies define permissions for an action regardless of "
        "the method that you use to perform the operation. Policies are JSON documents "
        "that consist of elements such as Effect, Action, Resource, and Condition. "
        "Use IAM policies to restrict access to AWS resources on a per-user or per-role basis."
    ),
    # 2 - Lambda handler
    (
        "[Lambda > Handler Function] The Lambda function handler is the method in your "
        "function code that processes events. When your function is invoked, Lambda runs "
        "the handler method. Your function runs until the handler returns a response, "
        "exits, or times out. Supported runtimes include Python, Node.js, Java, and Go."
    ),
    # 3 - DynamoDB tables
    (
        "[DynamoDB > Tables] In DynamoDB, a table is a collection of items, and each "
        "item is a collection of attributes. DynamoDB uses primary keys to uniquely "
        "identify each item in a table and secondary indexes to provide more querying "
        "flexibility. You can create a table with provisioned or on-demand capacity mode."
    ),
    # 4 - EC2 instance types
    (
        "[EC2 > Instance Types] Amazon EC2 provides a wide selection of instance types "
        "optimized to fit different use cases. Instance types comprise varying combinations "
        "of CPU, memory, storage, and networking capacity. T3 instances provide burstable "
        "performance, while C5 instances are compute-optimized for batch processing workloads."
    ),
    # 5 - VPC subnets
    (
        "[VPC > Subnets] A subnet is a range of IP addresses in your VPC. You launch "
        "AWS resources into a specified subnet. Use a public subnet for resources that "
        "must be connected to the internet and a private subnet for resources that will "
        "not be connected to the internet. Each subnet must reside entirely within one "
        "Availability Zone."
    ),
    # 6 - CloudFormation VPC template (config)
    (
        "[CloudFormation > VPC Template] Context: The following template creates a VPC "
        "with two subnets.\n```yaml\nAWSTemplateFormatVersion: '2010-09-09'\nResources:\n"
        "  MyVPC:\n    Type: AWS::EC2::VPC\n    Properties:\n      CidrBlock: 10.0.0.0/16\n"
        "  PublicSubnet:\n    Type: AWS::EC2::Subnet\n    Properties:\n      VpcId: !Ref MyVPC\n"
        "      CidrBlock: 10.0.1.0/24\n```"
    ),
    # 7 - RDS connections
    (
        "[RDS > Connectivity] To connect to an Amazon RDS DB instance, use the endpoint "
        "and port provided in the Amazon RDS console. For MySQL, use the mysql client. "
        "For PostgreSQL, use psql. Configure the security group to allow inbound traffic "
        "on the database port from your application servers or Lambda functions."
    ),
    # 8 - Lambda + RDS
    (
        "[Lambda > Database Access] You can configure a Lambda function to connect to an "
        "Amazon RDS database. Use RDS Proxy to pool and share database connections for "
        "improved scalability. Place the Lambda function in the same VPC as your RDS "
        "instance and configure the security groups to allow traffic between them."
    ),
    # 9 - S3 versioning
    (
        "[S3 > Versioning] Versioning in Amazon S3 is a means of keeping multiple variants "
        "of an object in the same bucket. You can use versioning to preserve, retrieve, "
        "and restore every version of every object stored in your Amazon S3 bucket. "
        "With versioning you can recover from both unintended user actions and application failures."
    ),
    # 10 - IAM roles for EC2
    (
        "[IAM > Roles for EC2] An IAM role is an identity that you can assume to obtain "
        "temporary security credentials. You can use roles to delegate access to users, "
        "applications, or services that don't normally have access to your AWS resources. "
        "Instance profiles allow EC2 instances to assume IAM roles."
    ),
    # 11 - SQS message processing
    (
        "[SQS > Message Processing] Amazon SQS offers standard and FIFO queues. Standard "
        "queues offer maximum throughput, best-effort ordering, and at-least-once delivery. "
        "FIFO queues are designed to guarantee that messages are processed exactly once, "
        "in the exact order that they are sent. Use dead-letter queues to handle failed messages."
    ),
    # 12 - CloudWatch alarms
    (
        "[CloudWatch > Alarms] A CloudWatch alarm watches a single metric over a specified "
        "time period and performs one or more specified actions based on the value of the "
        "metric relative to a threshold. You can create alarms to automatically stop, "
        "terminate, reboot, or recover your EC2 instances based on metric thresholds."
    ),
    # 13 - ECS task definitions
    (
        "[ECS > Task Definitions] A task definition is a text file in JSON format that "
        "describes one or more containers that form your application. You can use it to "
        "specify the Docker image, CPU and memory requirements, port mappings, volumes, "
        "and networking configuration for your containers running on Amazon ECS."
    ),
    # 14 - EKS clusters
    (
        "[EKS > Clusters] Amazon EKS runs the Kubernetes control plane across multiple "
        "Availability Zones to ensure high availability. EKS automatically manages the "
        "availability and scalability of the Kubernetes API servers and etcd persistence "
        "layer. You can use managed node groups to automate provisioning of worker nodes."
    ),
    # 15 - Route53 DNS
    (
        "[Route53 > DNS Routing] Amazon Route 53 is a highly available and scalable Domain "
        "Name System (DNS) web service. You can use Route 53 to perform three main functions: "
        "domain registration, DNS routing, and health checking. Route 53 supports several "
        "routing policies including simple, weighted, latency-based, and geolocation."
    ),
    # 16 - SNS notifications
    (
        "[SNS > Topics] Amazon SNS is a fully managed messaging service for both application-"
        "to-application and application-to-person communication. SNS topics allow publishers "
        "to send messages to multiple subscribers. Supported protocols include HTTP/S, email, "
        "SQS, Lambda, and SMS."
    ),
    # 17 - S3 IAM policy example (config)
    (
        "[S3 > Access Control > IAM Policy Example] Context: This policy grants read-only "
        "access to a specific S3 bucket.\n```json\n{\n  \"Version\": \"2012-10-17\",\n"
        "  \"Statement\": [{\n    \"Effect\": \"Allow\",\n    \"Action\": [\"s3:GetObject\","
        " \"s3:ListBucket\"],\n    \"Resource\": [\n      \"arn:aws:s3:::my-bucket\",\n"
        "      \"arn:aws:s3:::my-bucket/*\"\n    ]\n  }]\n}\n```"
    ),
    # 18 - ElastiCache Redis
    (
        "[ElastiCache > Redis] Amazon ElastiCache for Redis is a fast, fully managed, "
        "in-memory data store that can be used as a database, cache, message broker, "
        "and queue. ElastiCache for Redis supports data structures such as strings, "
        "hashes, lists, sets, and sorted sets with range queries."
    ),
    # 19 - Lambda layers
    (
        "[Lambda > Layers] A Lambda layer is a ZIP archive that contains libraries, a "
        "custom runtime, or other dependencies. Layers let you keep your deployment package "
        "small and allow you to share code and data across multiple Lambda functions. "
        "You can include up to five layers per function."
    ),
    # 20 - EC2 Auto Scaling
    (
        "[EC2 > Auto Scaling] Amazon EC2 Auto Scaling helps you ensure that you have the "
        "correct number of Amazon EC2 instances available to handle the load for your "
        "application. You configure Auto Scaling groups with minimum, maximum, and desired "
        "capacity. Scaling policies adjust the group size based on CloudWatch metrics."
    ),
    # 21 - DynamoDB Streams
    (
        "[DynamoDB > Streams] DynamoDB Streams captures a time-ordered sequence of item-level "
        "modifications in a DynamoDB table and stores this information for up to 24 hours. "
        "Applications can access this log and view the data items as they appeared before and "
        "after they were modified. Lambda triggers can process stream records in near real-time."
    ),
    # 22 - VPC security groups
    (
        "[VPC > Security Groups] A security group acts as a virtual firewall for your instance "
        "to control inbound and outbound traffic. When you launch an instance in a VPC, you "
        "can assign up to five security groups to the instance. Security groups act at the "
        "instance level, not the subnet level. Rules are stateful."
    ),
    # 23 - CloudFormation Lambda function (config)
    (
        "[CloudFormation > Lambda Template] Context: Deploy a Lambda function with a DynamoDB "
        "trigger.\n```yaml\nAWSTemplateFormatVersion: '2010-09-09'\nResources:\n  MyFunction:\n"
        "    Type: AWS::Lambda::Function\n    Properties:\n      Runtime: python3.12\n"
        "      Handler: index.handler\n      Code:\n        S3Bucket: my-deployment-bucket\n"
        "        S3Key: lambda.zip\n  StreamMapping:\n    Type: AWS::Lambda::EventSourceMapping\n"
        "    Properties:\n      EventSourceArn: !GetAtt MyTable.StreamArn\n"
        "      FunctionName: !Ref MyFunction\n```"
    ),
]

# ---------------------------------------------------------------------------
# Query -> expected chunk index pairs
# Each tuple is (query, list-of-expected-chunk-indices)
# ---------------------------------------------------------------------------

QUERY_EXPECTATIONS = [
    # Exact service name matches
    ("S3 bucket policy", [0]),
    ("IAM policy permissions JSON", [1]),
    ("Lambda function handler", [2]),
    ("DynamoDB table primary key", [3]),
    ("EC2 instance types T3 C5", [4]),
    # Semantic / conceptual matches
    ("how to restrict access to AWS resources", [1]),
    ("keeping old versions of files in S3", [9]),
    ("automatically scale EC2 instances based on load", [20]),
    ("process messages in order exactly once", [11]),
    ("DNS routing policies", [15]),
    # Code / config queries
    ("CloudFormation VPC template", [6]),
    ("S3 read-only IAM policy JSON", [17]),
    ("CloudFormation Lambda DynamoDB trigger template", [23]),
    # Cross-service queries
    ("Lambda function connecting to RDS database", [8]),
    ("DynamoDB stream triggering Lambda", [21, 23]),
    ("send notifications from SNS to SQS and Lambda", [16]),
    ("EC2 monitoring CloudWatch alarms", [12]),
    ("container task definition Docker ECS", [13]),
    ("Kubernetes managed node groups EKS", [14]),
    ("Redis caching with ElastiCache", [18]),
    ("share code across Lambda functions with layers", [19]),
    ("VPC subnet public private availability zone", [5]),
    ("security group firewall inbound outbound rules", [22]),
    ("RDS Proxy Lambda database connection pooling", [8]),
]


@pytest.mark.slow
class TestRetrievalRecall:
    """Test that BGE embeddings produce sufficient recall@5 on AWS doc chunks."""

    @pytest.fixture(scope="class")
    def embedder(self):
        from ingestion.embedder.bge import BGEEmbedder

        emb = BGEEmbedder()
        emb._load_model()
        return emb

    @pytest.fixture(scope="class")
    def chunk_embeddings(self, embedder):
        """Embed all chunks once for the whole test class."""
        from ingestion.models import Chunk, ChunkType

        chunks = [
            Chunk(
                text=text,
                chunk_type=ChunkType.PROSE,
                section_path="",
                token_count=0,
            )
            for text in CHUNKS
        ]
        embedder.embed_chunks(chunks, batch_size=32)
        return np.array([c.embedding for c in chunks], dtype=np.float32)

    def _top_k(self, embedder, chunk_embeddings: np.ndarray, query: str, k: int = 5) -> list[int]:
        """Return the indices of the top-k chunks by inner product with the query."""
        query_emb = embedder.embed_query(query)
        scores = chunk_embeddings @ query_emb
        top_indices = np.argsort(scores)[::-1][:k].tolist()
        return top_indices

    def test_recall_at_5(self, embedder, chunk_embeddings):
        """Compute recall@5 across all query/expected pairs and assert >= 0.7."""
        hits = 0
        total = 0
        failures = []

        for query, expected_indices in QUERY_EXPECTATIONS:
            top5 = self._top_k(embedder, chunk_embeddings, query, k=5)
            # A query is a hit if ANY expected chunk appears in the top-5
            found = any(idx in top5 for idx in expected_indices)
            if found:
                hits += 1
            else:
                failures.append((query, expected_indices, top5))
            total += 1

        recall = hits / total if total > 0 else 0.0
        print(f"\n{'='*60}")
        print(f"Retrieval Recall@5: {recall:.2%} ({hits}/{total})")
        print(f"{'='*60}")

        if failures:
            print(f"\nMissed queries ({len(failures)}):")
            for query, expected, top5 in failures:
                print(f"  Q: {query!r}")
                print(f"    Expected chunk(s): {expected}, Got top-5: {top5}")

        assert recall >= 0.7, (
            f"Recall@5 is {recall:.2%} ({hits}/{total}), expected >= 70%. "
            f"Failed queries: {[q for q, _, _ in failures]}"
        )

    @pytest.mark.parametrize(
        "query, expected_indices",
        QUERY_EXPECTATIONS,
        ids=[q for q, _ in QUERY_EXPECTATIONS],
    )
    def test_individual_query(self, embedder, chunk_embeddings, query, expected_indices):
        """Each query should have at least one expected chunk in top-5."""
        top5 = self._top_k(embedder, chunk_embeddings, query, k=5)
        found = [idx for idx in expected_indices if idx in top5]
        assert found, (
            f"Query {query!r}: none of expected chunks {expected_indices} "
            f"found in top-5 {top5}"
        )
