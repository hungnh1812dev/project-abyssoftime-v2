import type { CvNewPageDataType } from "../cv-new.types";
import { CvNewSection } from "../shared/CvNewSection";

import { HTMLParser } from "@/lib/html-parser";
import type { CommonTextType } from "@/views/cv/common-text.types";

interface CvNewExperienceProps {
  experiences: CvNewPageDataType["experiences"];
  commonText: CommonTextType;
}

export const CvNewExperience = ({
  experiences,
  commonText,
}: CvNewExperienceProps) => {
  return (
    <CvNewSection
      title={
        commonText.text["work-experience"] ?? "Work Experience & Key Projects"
      }
      id="experience"
    >
      <div className="space-y-6">
        {experiences.map((group, groupIdx) => (
          <div key={groupIdx}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-r-md border-l-4 border-primary bg-muted px-3 py-2">
              <h4 className="text-sm font-bold text-primary">
                {group.company}
              </h4>
              <span className="text-xs text-foreground/55">
                {[group.location, group.period].filter(Boolean).join(" · ")}
              </span>
            </div>

            <div className="mt-3 space-y-4">
              {group.roles.map((role, roleIdx) => (
                <div key={roleIdx}>
                  <div className="print:break-inside-avoid">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <p className="text-sm font-semibold uppercase tracking-wide text-foreground/80">
                        {role.position}
                      </p>
                      <p className="text-xs font-medium text-foreground/50">
                        {role.period}
                      </p>
                    </div>
                    <HTMLParser
                      content={role.responsibilities}
                      className="mt-1.5 text-sm text-foreground/75 [&>li]:pb-0.5 [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:pt-0.5"
                    />
                    {role.techStack && role.techStack.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-start gap-x-2">
                        <span className="text-sm font-semibold text-foreground/70">
                          {commonText.text["technologies"] ?? "Technologies"}:
                        </span>
                        <div className="flex flex-1 flex-wrap gap-1">
                          {role.techStack.map((tech) => (
                            <span
                              key={tech}
                              className="rounded-full border border-border/60 bg-muted px-2 py-0.5 text-xs text-foreground/55"
                            >
                              {tech}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {role.projects && role.projects.length > 0 && (
                    <div className="mt-3 space-y-3">
                      {role.projects.map((project, projectIdx) => (
                        <div
                          key={projectIdx}
                          className="rounded-r-md border-l-[3px] border-primary/50 bg-muted/60 p-3 print:break-inside-avoid"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                            <h5 className="text-sm font-bold text-foreground">
                              {project.name}
                            </h5>
                            {(project.role || project.teamSize > 1) && (
                              <p className="text-xs italic text-foreground/55">
                                {[
                                  project.role,
                                  project.teamSize > 1
                                    ? `Team of ${project.teamSize}`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            )}
                          </div>
                          <p className="mt-1.5 text-sm font-semibold text-foreground/70">
                            {commonText.text["achievements"] ?? "Achievements"}:
                          </p>
                          <HTMLParser
                            content={project.responsibilities}
                            className="mt-0.5 text-sm text-foreground/75 [&>li]:pb-0.5 [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:pt-0.5"
                          />
                          {project.techStack &&
                            project.techStack.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap items-start gap-x-2">
                                <span className="text-sm font-semibold text-foreground/70">
                                  {commonText.text["technologies"] ??
                                    "Technologies"}
                                  :
                                </span>
                                <div className="flex flex-1 flex-wrap gap-1">
                                  {project.techStack.map((tech) => (
                                    <span
                                      key={tech}
                                      className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-xs text-foreground/55"
                                    >
                                      {tech}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          {(project.liveLink || project.responsitoryLink) && (
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                              {project.liveLink && (
                                <span className="text-xs text-foreground/60">
                                  <span className="mt-1.5 text-sm font-semibold text-foreground/70">
                                    {commonText.text["live"] ?? "Live"}:
                                  </span>{" "}
                                  {project.liveLink}
                                </span>
                              )}
                              {project.responsitoryLink && (
                                <span className="text-xs text-foreground/60">
                                  <span className="font-semibold text-foreground/50">
                                    {commonText.text["github"] ?? "GitHub"}:
                                  </span>{" "}
                                  {project.responsitoryLink}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </CvNewSection>
  );
};
