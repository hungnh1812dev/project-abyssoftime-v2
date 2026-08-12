export const HEADER_QUERY = /* GraphQL */ `
  query GetHeader {
    header {
      name
      nav {
        title
        requiresRole
        link
        subNavigations {
          title
          requiresRole
          link
        }
      }
      author {
        btnLoginText
        btnLogoutText
      }
    }
  }
`;
