class PrismaClient {
  constructor() {
    throw new Error(
      `@prisma/client did not initialize yet. Please run "prisma2 generate" and try to import it again.
In case this error is unexpected for you, please report it in https://github.com/prisma/prisma-client-js/issues/390.`,
    )
  }
}

module.exports = {
  PrismaClient,
}
