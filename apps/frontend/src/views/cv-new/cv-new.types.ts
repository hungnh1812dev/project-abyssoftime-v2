export interface CvNewProjectType {
  name: string;
  liveLink: string;
  responsitoryLink: string;
  role: string;
  teamSize: number;
  techStack: string[];
  responsibilities: string;
}

export interface CvNewPageDataType {
  documentId: string;
  position: string;
  summary: string;
  educations: {
    degree: string;
    description: string;
    institution: string;
    location: string;
    period: string;
  }[];
  experiences: {
    company: string;
    location: string;
    period: string;
    roles: {
      period: string;
      position: string;
      projects?: CvNewProjectType[];
      responsibilities: string;
      teamSize: number;
      techStack: string[];
    }[];
  }[];
  skills: {
    level: string;
    skill: string;
  }[];
  languages: {
    language: string;
    level: string;
  }[];
  references: {
    name: string;
    role: string;
    phone: string;
  }[];
}

export interface CvNewListItemType {
  documentId: string;
  name: string;
}
