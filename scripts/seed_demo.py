#!/usr/bin/env python3
"""Seed the index with a small set of realistic AWS doc chunks for local demos.

Unlike a live crawl, this is deterministic and offline (no network), so the
search + RAG flow can be demonstrated end-to-end regardless of the AWS docs
site's rendering. It reuses the project's own BGEEmbedder and PostgresIndexer,
so the real embedding + indexing code paths are exercised.

Run:
    PYTHONPATH=src .venv-embed/bin/python scripts/seed_demo.py
"""

from __future__ import annotations

import asyncio
import hashlib
import os
from datetime import datetime, timezone

from ingestion.chunker.token_counter import count_tokens
from ingestion.embedder.bge import BGEEmbedder
from ingestion.indexer.postgres import PostgresIndexer
from ingestion.models import Chunk, ChunkType

DSN = os.getenv(
    "DATABASE_URL",
    "postgresql://cloudsearch:cloudsearch@localhost:5432/cloudsearch",
)

# (url, service_name, title, [(text, chunk_type, section_path), ...])
DOCS: list[tuple[str, str, str, list[tuple[str, ChunkType, str]]]] = [
    (
        "https://docs.aws.amazon.com/AmazonS3/latest/userguide/create-bucket-overview.html",
        "s3",
        "Creating a bucket",
        [
            (
                "To create an Amazon S3 bucket, sign in to the AWS Management Console and open the "
                "Amazon S3 console. Choose Create bucket. Enter a globally unique bucket name and "
                "choose the AWS Region where you want the bucket to reside. Bucket names must be "
                "between 3 and 63 characters long and can contain only lowercase letters, numbers, "
                "dots, and hyphens. Block Public Access settings are enabled by default to help you "
                "keep your data private.",
                ChunkType.PROSE,
                "S3 > Buckets > Creating a bucket",
            ),
            (
                "aws s3api create-bucket \\\n"
                "    --bucket my-unique-bucket-name \\\n"
                "    --region us-east-1",
                ChunkType.CODE,
                "S3 > Buckets > Creating a bucket > AWS CLI",
            ),
        ],
    ),
    (
        "https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-policies.html",
        "s3",
        "Using bucket policies",
        [
            (
                "A bucket policy is a resource-based AWS Identity and Access Management (IAM) policy "
                "that you can use to grant access permissions to your bucket and the objects in it. "
                "Only the bucket owner can associate a policy with a bucket. The permissions attached "
                "to the bucket apply to all of the objects in the bucket that are owned by the bucket "
                "owner. Bucket policies are written in JSON and attached directly to the S3 bucket.",
                ChunkType.PROSE,
                "S3 > Bucket Policies",
            ),
            (
                '{\n'
                '  "Version": "2012-10-17",\n'
                '  "Statement": [\n'
                '    {\n'
                '      "Sid": "AllowPublicRead",\n'
                '      "Effect": "Allow",\n'
                '      "Principal": "*",\n'
                '      "Action": "s3:GetObject",\n'
                '      "Resource": "arn:aws:s3:::my-bucket/*"\n'
                '    }\n'
                '  ]\n'
                '}',
                ChunkType.CONFIG,
                "S3 > Bucket Policies > Examples",
            ),
        ],
    ),
    (
        "https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html",
        "s3",
        "Using versioning in S3 buckets",
        [
            (
                "Versioning in Amazon S3 is a means of keeping multiple variants of an object in the "
                "same bucket. You can use the S3 Versioning feature to preserve, retrieve, and "
                "restore every version of every object stored in your buckets. With versioning you "
                "can recover more easily from both unintended user actions and application failures. "
                "After you enable versioning on a bucket, you cannot disable it; you can only suspend "
                "versioning.",
                ChunkType.PROSE,
                "S3 > Data protection > Versioning",
            ),
        ],
    ),
    (
        "https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html",
        "iam",
        "Policies and permissions in IAM",
        [
            (
                "You manage access in AWS by creating policies and attaching them to IAM identities "
                "(users, groups of users, or roles) or AWS resources. A policy is an object in AWS "
                "that, when associated with an identity or resource, defines their permissions. AWS "
                "evaluates these policies when an IAM principal (user or role) makes a request. "
                "Permissions in the policies determine whether the request is allowed or denied. To "
                "restrict access, follow the principle of least privilege and grant only the "
                "permissions required to perform a task.",
                ChunkType.PROSE,
                "IAM > Access management > Policies and permissions",
            ),
            (
                '{\n'
                '  "Version": "2012-10-17",\n'
                '  "Statement": [\n'
                '    {\n'
                '      "Effect": "Allow",\n'
                '      "Action": ["s3:GetObject", "s3:ListBucket"],\n'
                '      "Resource": [\n'
                '        "arn:aws:s3:::my-bucket",\n'
                '        "arn:aws:s3:::my-bucket/*"\n'
                '      ]\n'
                '    }\n'
                '  ]\n'
                '}',
                ChunkType.CONFIG,
                "IAM > Access management > Policy examples",
            ),
        ],
    ),
    (
        "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html",
        "lambda",
        "What is AWS Lambda",
        [
            (
                "AWS Lambda is a compute service that lets you run code without provisioning or "
                "managing servers. Lambda runs your code on a high-availability compute "
                "infrastructure and performs all of the administration of the compute resources, "
                "including server and operating system maintenance, capacity provisioning, automatic "
                "scaling, and logging. With Lambda, you can run code for virtually any type of "
                "application or backend service. You organize your code into Lambda functions.",
                ChunkType.PROSE,
                "Lambda > Introduction > What is Lambda",
            ),
        ],
    ),
]


async def main() -> None:
    embedder = BGEEmbedder()
    indexer = PostgresIndexer(DSN)
    await indexer.connect()
    try:
        total_chunks = 0
        for url, service, title, raw_chunks in DOCS:
            chunks = [
                Chunk(
                    text=text,
                    chunk_type=ctype,
                    section_path=spath,
                    token_count=count_tokens(text),
                )
                for (text, ctype, spath) in raw_chunks
            ]
            embedder.embed_chunks(chunks)  # sets .embedding (L2-normalized, no query prefix)
            content_hash = hashlib.sha256("".join(c.text for c in chunks).encode()).hexdigest()
            await indexer.index_document(
                url=url,
                service_name=service,
                title=title,
                content_hash=content_hash,
                chunks=chunks,
                crawled_at=datetime.now(timezone.utc),
            )
            total_chunks += len(chunks)
            print(f"  indexed {service:8s} {len(chunks)} chunks  {title}")

        stats = await indexer.get_stats()
        print(f"\nSeed complete: {stats['documents']} documents, {stats['chunks']} chunks")
        print(f"  per-service docs:   {stats['docs_per_service']}")
        print(f"  per-service chunks: {stats['chunks_per_service']}")
    finally:
        await indexer.close()


if __name__ == "__main__":
    asyncio.run(main())
