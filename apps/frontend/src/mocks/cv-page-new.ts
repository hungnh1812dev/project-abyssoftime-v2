import type { CvNewPageDataType } from "@/views/cv-new/cv-new.types";

export const CVPageNew_MockData: Omit<CvNewPageDataType, "documentId"> = {
  position: "Senior Frontend Developer",
  summary:
    "<p><strong>6 years</strong> building production frontend at Gameloft — <strong>React</strong>/<strong>Next.js</strong>/<strong>TypeScript</strong>, apps handling <strong>3M+ users</strong>. Picked the right rendering strategy (<strong>SSR</strong>/<strong>ISR</strong>/<strong>CSR</strong>) per use case, set up <strong>Strapi CMS</strong> with custom plugins, and handled <strong>GitLab CI/CD</strong> and <strong>Kubernetes</strong> from scratch.</p>",
  educations: [
    {
      degree: "Bachelor of Science in Information Technology",
      description: "",
      institution: "University of Science (HCMUS)",
      location: "Ho Chi Minh City",
      period: "2011 – 2016",
    },
  ],
  experiences: [
    {
      company: "Gameloft Company",
      location: "Ho Chi Minh City",
      period: "Mar 2020 – 2026",
      roles: [
        {
          period: "Mar 2022 – 2026",
          position: "Senior Frontend Developer",
          responsibilities:
            "<ul><li>Owned the full frontend from project setup through deployment on multiple campaigns; <strong>mentored 4 developers</strong> mainly through <strong>code reviews</strong>.</li><li>Picked <strong>SSR</strong> for user data, <strong>ISR</strong> for game content — <strong>LCP dropped 43%</strong> on the main site.</li></ul>",
          teamSize: 7,
          techStack: ["React", "Next.js", "TypeScript", "Tailwind CSS", "GraphQL", "Kubernetes", "Strapi"],
          projects: [
            {
              name: "Disney Dreamlight Valley: Yearly Wrap-up Website",
              liveLink: "https://disneydreamlightvalley.com/wrap-up/global",
              responsitoryLink: "",
              role: "Senior Frontend Developer & Reviewer",
              teamSize: 3,
              techStack: ["React", "Next.js", "TypeScript", "Tailwind CSS", "GSAP", "K6", "Kubernetes"],
              responsibilities:
                "<ul><li>Joined early frontend design discussions for the <strong>wrap-up flow</strong>.</li><li>Built the profile system used by <strong>3M+ users</strong> — SSR for user data, ISR for static content.</li></ul>",
            },
            {
              name: "Disney Dreamlight Valley",
              liveLink: "https://disneydreamlightvalley.com/",
              responsitoryLink: "",
              role: "Main PIC & Reviewer",
              teamSize: 6,
              techStack: ["React", "Next.js", "TypeScript", "Tailwind CSS", "GraphQL", "GSAP", "Kubernetes", "Sentry"],
              responsibilities:
                "<ul><li>Built the full <strong>Strapi CMS</strong> from scratch with <strong>SSG/ISR</strong> rendering.</li><li>Day-1 sessions hit <strong>70,851</strong> vs <strong>12,671</strong> on the prior expansion (<strong>+559%</strong>).</li></ul>",
            },
          ],
        },
        {
          period: "Mar 2020 – Feb 2022",
          position: "Frontend Developer",
          responsibilities:
            "<ul><li>Built and maintained web applications from Figma designs using <strong>React.js, Next.js</strong>, and <strong>TypeScript</strong>.</li><li>Handled a major <strong>React version upgrade</strong> mid-project and debugged several production rendering issues.</li></ul>",
          teamSize: 4,
          techStack: ["React", "Next.js", "JavaScript", "TypeScript", "Strapi", "Kubernetes"],
          projects: [],
        },
      ],
    },
  ],
  skills: [
    {
      level: "Proficient",
      skill: "React,Next.js,TypeScript,JavaScript (ES6+),HTML5,CSS3,SCSS,Tailwind CSS,SWR,Context API,Jotai,Git",
    },
    {
      level: "Intermediate",
      skill: "Material UI,Shadcn UI,React Query (TanStack),Webpack,Vite,Sentry,AWS RUM,Vitest,React Testing Library",
    },
    {
      level: "Working Knowledge",
      skill: "Core Web Vitals,Browser Rendering,GitLab CI/CD,Github Action,Docker,Kubernetes,Jira,Scrum/Agile",
    },
  ],
  languages: [
    { language: "Vietnamese", level: "Native" },
    { language: "English", level: "Read/Written: Intermediate · Spoken: Conversational" },
  ],
  references: [
    { name: "A", role: "H", phone: "0123456789" },
    { name: "B", role: "H", phone: "1234567890" },
  ],
};
