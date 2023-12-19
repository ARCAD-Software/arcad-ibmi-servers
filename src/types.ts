export type AFSWrapperLocation = {
  library: string
  version: string
  iasp?: number
};

export type AFSServerWrappers = {
  host: string
  locations: AFSWrapperLocation[]
};

export type AFSServer = {
  library: string
  name: string
  jobqName:string
  jobqLibrary:string
  ifsPath:string
  user:string
  javaProps:string
  javaHome:string
  jobName:string
  jobUser:string
  jobNumber:string
  running:boolean
  jobStatus?:string
};