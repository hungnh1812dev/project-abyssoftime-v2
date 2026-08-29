import { FieldDefinition } from "../../domain/entities/field-definition";
import * as path from "node:path";

import { type ConfigService } from "@nestjs/config";

import { type EnvironmentVariables } from "@/config/env.validation";

import { SchemaLoaderService } from "./schema-loader.service";

const CONTENT_TYPES_DIR = path.join(__dirname, "../../../../../content-types");

function buildService(): SchemaLoaderService {
  const configService = { get: jest.fn() };
  return new SchemaLoaderService(configService as unknown as ConfigService<EnvironmentVariables, true>);
}

function findField(fields: FieldDefinition[], name: string): FieldDefinition {
  const field = fields.find((candidate) => candidate.name === name);
  if (!field) {
    throw new Error(`Expected field "${name}" among [${fields.map((f) => f.name).join(", ")}]`);
  }
  return field;
}

describe("cv-page-new content type", () => {
  it("parses and validates alongside every other real content-type definition", async () => {
    const definitions = await buildService().loadFromDir(CONTENT_TYPES_DIR);

    const cvPageNew = definitions.find((definition) => definition.slug === "cv-page-new");

    expect(cvPageNew).toBeDefined();
  });

  it("has no top-level projects field", async () => {
    const [cvPageNew] = (await buildService().loadFromDir(CONTENT_TYPES_DIR)).filter((d) => d.slug === "cv-page-new");

    expect(cvPageNew.fields.some((field) => field.name === "projects")).toBe(false);
  });

  it("nests a repeatable project component three levels deep under experiences.roles.projects", async () => {
    const [cvPageNew] = (await buildService().loadFromDir(CONTENT_TYPES_DIR)).filter((d) => d.slug === "cv-page-new");

    const experiences = findField(cvPageNew.fields, "experiences");
    expect(experiences.repeatable).toBe(true);

    const roles = findField(experiences.fields ?? [], "roles");
    expect(roles.repeatable).toBe(true);

    const projects = findField(roles.fields ?? [], "projects");
    expect(projects.type).toBe("component");
    expect(projects.component).toBe("project");
    expect(projects.repeatable).toBe(true);
    expect((projects.fields ?? []).map((field) => field.name)).toEqual(
      expect.arrayContaining(["name", "teamSize", "role", "liveLink", "responsitoryLink", "techStack", "responsibilities"]),
    );
  });

  it("gives experience a period field for the company-level date range", async () => {
    const [cvPageNew] = (await buildService().loadFromDir(CONTENT_TYPES_DIR)).filter((d) => d.slug === "cv-page-new");

    const experiences = findField(cvPageNew.fields, "experiences");
    const period = findField(experiences.fields ?? [], "period");

    expect(period.type).toBe("text");
  });
});
