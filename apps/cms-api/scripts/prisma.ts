const schemaPath = "prisma/postgresql/schema.prisma";
const args = process.argv.slice(2);

void (async () => {
  await Bun.$`prisma ${args} --schema=${schemaPath}`;
})();
