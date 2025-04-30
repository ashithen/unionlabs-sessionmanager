# UnionLabs Testbed Session Manager

> [!NOTE]
> This is a Proof of Concept (PoC) project.

Remote access and session orchestration for the UnionLabs testbed platform. Manages Docker session containers, SSH tunnels, and VNC remote access.

## Prerequisites

- Node.js >= 18.0.0
- Docker

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env to adjust port or database path if needed
   ```

3. Seed the database:
   ```bash
   npm run seed
   ```

4. Start in development mode:
   ```bash
   npm run dev
   ```

## Development and Testing

- Run tests: `npm test`
- Lint: `npm run lint`
- Build docker image: `docker build -t unionlabs/session:latest -f docker/Dockerfile.session docker/`
