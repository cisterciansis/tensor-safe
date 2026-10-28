# Tensor Safe on Caution, bring-your-own-compute (AWS Nitro Enclaves).
# Field reference: https://docs.caution.co/reference/caution-hcl/
# Runbook: docs/deploy-caution.md. Replace every TODO before the first push.

caution {
  provider {
    type   = "aws"
    region = "TODO-aws-region" # e.g. "us-east-1"; same region as the Postgres instance
    # From `caution init --byoc` output (or the VPC you passed as VPC_ID).
    # The Postgres instance must live in, or be routable from, this VPC.
    vpc_id            = "TODO-vpc-id"
    subnet_ids        = ["TODO-subnet-id-a", "TODO-subnet-id-b"]
    security_group_id = "TODO-security-group-id"
  }
}

enclave "main" {
  build {
    containerfile = "Containerfile"
    app_sources   = ["https://github.com/cisterciansis/tensor-safe.git"]
    # Never reuse a builder cache for a verifiable release.
    cache = false
  }

  # Must hold the ~500 MB root filesystem (the enclave has no disk, so the whole
  # image lives in enclave RAM) plus Node and @polkadot/api metadata caches for
  # mainnet and testnet. 2 vCPUs is the smallest enclave; both values fit the
  # m5.xlarge tier (enclave capacity: 2 vCPUs, 14 GB), so headroom costs nothing.
  resources {
    cpu       = 2
    memory_mb = 4096
  }

  # Relaunch after any termination. A relaunched enclave starts locked: holders
  # must release secret shares again before the app serves (docs/deploy-caution.md).
  restart {
    policy        = "always"
    delay_seconds = 10
  }

  network {
    # Attested TLS requires 0.0.0.0/0 on the HTTP port; 8080 stays an
    # enclave-local upstream behind enclave Caddy on 443, never a raw listener.
    ingress {
      cidr_ipv4 = "0.0.0.0/0"
      port      = 8080
    }

    # Egress is CIDR + port only (no hostname allowlist). DNS goes to the parent
    # relay only; Attested TLS startup needs it too.
    egress {
      cidr_ipv4   = "10.0.100.1/32"
      ip_protocol = "udp"
      port        = 53
    }
    egress {
      cidr_ipv4   = "10.0.100.1/32"
      ip_protocol = "tcp"
      port        = 53
    }
    # HTTPS/WSS only: ACME for the enclave certificate plus the Bittensor RPC
    # (entrypoint-finney / test.finney.opentensor.ai). Those names sit behind
    # CNAMEs to edge hosts and Let's Encrypt behind Cloudflare, so pinning
    # today's IPs would break silently when they move.
    egress {
      cidr_ipv4   = "0.0.0.0/0"
      ip_protocol = "tcp"
      port        = 443
    }
    # Postgres: the DB subnet group CIDR(s) only, never 0.0.0.0/0. Repeat the
    # block per subnet; a Multi-AZ failover moves the instance between them.
    egress {
      cidr_ipv4   = "TODO-db-subnet-cidr" # e.g. "10.0.32.0/24"
      ip_protocol = "tcp"
      port        = 5432
    }

    http {
      domain = "TODO-subdomain.example.com" # must equal PUBLIC_ORIGIN's host
      port   = 8080
      # TLS terminates inside the enclave: the host never sees sessions,
      # cookies or workspace data. Ordinary browsers work without a STEVE client.
      e2e_encryption {
        mode = "tls"
      }
    }
  }

  unit "default" {
    command = "/usr/bin/node"
    args    = ["/app/dist/server/main.js"]
    env = {
      PORT          = "8080"
      PUBLIC_ORIGIN = "https://TODO-subdomain.example.com"
      STATIC_DIR    = "/app/dist/client"
      DB_DIR        = "/app/db"
      # Enclave Caddy is the only path to :8080 and sets X-Forwarded-For.
      TRUST_PROXY = "1"
      # postgres://user@host:5432/db?sslmode=verify-full (password in the URL)
      DATABASE_URL = env::vault("DATABASE_URL")
      # base64 of 32 random bytes; never in the image or this file.
      DATA_KEY = env::vault("DATA_KEY")
    }
  }
}
