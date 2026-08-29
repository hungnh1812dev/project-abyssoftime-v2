export const GET_MAIN_CV_NEW = /* GraphQL */ `
  query GetMainCvNew {
    cvPageNews(where: { isMain: { eq: true } }) {
      items {
        name
        isMain
        documentId
        educations {
          degree
          description
          institution
          location
          period
        }
        experiences {
          company
          location
          period
          roles {
            period
            position
            projects {
              liveLink
              name
              responsibilities
              responsitoryLink
              role
              teamSize
              techStack
            }
            responsibilities
            teamSize
            techStack
          }
        }
        languages {
          language
          level
        }
        position
        references {
          role
          name
          phone
        }
        skills {
          level
          skill
        }
        summary
      }
    }
  }
`;

export const GET_CV_NEW_LIST = /* GraphQL */ `
  query GetCvNewList {
    cvPageNews(where: { isMain: { ne: true } }) {
      items {
        documentId
        name
      }
    }
  }
`;

export const GET_CV_NEW_BY_DOCUMENT_ID = /* GraphQL */ `
  query GetCvNewByDocumentId($documentId: ID!) {
    cvPageNew(documentId: $documentId) {
      name
      isMain
      documentId
      educations {
        degree
        description
        institution
        location
        period
      }
      experiences {
        company
        location
        period
        roles {
          period
          position
          projects {
            liveLink
            name
            responsibilities
            responsitoryLink
            role
            teamSize
            techStack
          }
          responsibilities
          teamSize
          techStack
        }
      }
      languages {
        language
        level
      }
      position
      references {
        role
        name
        phone
      }
      skills {
        level
        skill
      }
      summary
    }
  }
`;
