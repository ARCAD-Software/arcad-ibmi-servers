export type ServerLocation = {
  library: string
  dataArea: string
  iasp?: number
  type: 'AFS' | 'Jetty'
};

export type AFSServerWrappers = {
  host: string
  locations: ServerLocation[]
};

export type AFSServer = {
  library: string
  name: string
  jobqName: string
  jobqLibrary: string
  ifsPath: string
  user: string
  javaProps: string
  javaHome: string
  jobName: string
  jobUser: string
  jobNumber: string
  running: boolean
  jobStatus?: string
  configuration: AFSServerConfiguration
};

export type JettyServer = {
  library: string
  ifsPath: string
  running: boolean
  configuration: JettyConfiguration
  jobName?: string
  jobUser?: string
  jobNumber?: string
  jobStatus?: string
  subsystem?: string
};

export type JettyConfiguration = {
  httpsPort?:number
  keystore?:string
  httpPort?: number
};

export type AFSServerConfiguration = { error?: "noconfig" | "nofolder" } & Record<string, Record<string, string>>;

export type AFSServerUpdate = {
  user: string
  jobqName: string
  jobqLibrary: string
  ifsPath: string
  javaProps: string
  javaHome: string
};

export type InstallationProperties = Map<string, string>;

export type ArcadInstance = {
  code:string
  text:string  
  version:string
  library:string
  iasp?:string
};

export type ArcadLicense = {
  name: string
  license: string
  count: number
  type: "T" | "D"
  limit: string
  warning: string
};