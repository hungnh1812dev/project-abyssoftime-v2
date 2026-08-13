export interface HeaderSubNavItem {
  title: string;
  requiresRole: string;
  link: string;
}

export interface HeaderNavItem {
  title: string;
  requiresRole: string;
  link: string;
  subNavigations: HeaderSubNavItem[];
}

export interface HeaderAuthor {
  btnLoginText: string;
  btnLogoutText: string;
}

export interface HeaderData {
  name: string;
  nav: HeaderNavItem[];
  author: HeaderAuthor;
}
