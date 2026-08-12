import type { HeaderData } from "@/views/header/header.types";

export interface HeaderMockResponse {
  data: {
    header: HeaderData;
  };
}

export const Header_MockData: HeaderMockResponse = {
  data: {
    header: {
      name: "Abyssoftime",
      nav: [
        { title: "Home", requiresRole: "all", link: "/", subNavigations: [] },
        { title: "CV", requiresRole: "all", link: "/cv", subNavigations: [] },
        { title: "CV Elegant", requiresRole: "admin", link: "/cv-2", subNavigations: [] },
        { title: "EN Vocabulary", requiresRole: "admin", link: "/learning/english", subNavigations: [] },
        { title: "Vaccine", requiresRole: "admin", link: "/vaccine", subNavigations: [] },
        { title: "React Knowledge", requiresRole: "admin", link: "/learning/develop/react", subNavigations: [] },
        { title: "Architecture", requiresRole: "admin", link: "/learning/develop/architecture", subNavigations: [] },
        { title: "Go Knowledge", requiresRole: "admin", link: "/learning/develop/go", subNavigations: [] },
        {
          title: "Interview",
          requiresRole: "admin",
          link: "/interview",
          subNavigations: [{ title: "Answers", requiresRole: "admin", link: "/interview/answers" }],
        },
        { title: "Secret", requiresRole: "super_admin", link: "/secret", subNavigations: [] },
        { title: "Account", requiresRole: "super_admin", link: "/account", subNavigations: [] },
      ],
      author: { btnLoginText: "Đăng nhập", btnLogoutText: "Đăng xuất" },
    },
  },
};
