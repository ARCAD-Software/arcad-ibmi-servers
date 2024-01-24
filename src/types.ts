export type AFSWrapperLocation = {
  library: string
  dataArea: string
  iasp?: number
  type : 'AFS' | 'Jetty'
};

export type AFSServerWrappers = {
  host: string
  locations: AFSWrapperLocation[]
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
  configuration: ServerConfiguration
};

export type JettyServer = {
  library: string
  running: boolean
  jobName?: string
  jobUser?: string
  jobNumber?: string
  jobStatus?: string
};

export type ServerConfiguration = { error?: "noconfig" | "nofolder" } & Record<string, Record<string, string>>;

export type ServerUpdate = {
  user: string
  jobqName: string
  jobqLibrary: string
  ifsPath: string
  javaProps: string
  javaHome: string
};

export type InstallationProperties = {
  ifsPath: string
  user: string
  library?: string
  instance?: string
  port?: number
  jobqName?: string
  jobqLibrary?: string
  iasp?: string
};