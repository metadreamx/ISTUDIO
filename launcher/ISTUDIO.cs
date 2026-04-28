using System;
using System.Diagnostics;
using System.IO;
using System.Net;

internal static class Program
{
    private const string Repo = "metadreamx/ISTUDIO";

    private static int Main()
    {
        try
        {
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;

            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            string localBat = Path.Combine(appDir, "LAUNCH ISTUDIO.bat");

            if (File.Exists(localBat))
            {
                return Run("cmd.exe", "/c " + Quote(localBat), appDir);
            }

            Console.WriteLine("ISTUDIO Launcher");
            Console.WriteLine();
            Console.WriteLine("Installing or repairing ISTUDIO automatically...");
            Console.WriteLine();

            string installerPath = Path.Combine(Path.GetTempPath(), "Install-ISTUDIO-" + Guid.NewGuid() + ".ps1");
            string installerUrl = "https://raw.githubusercontent.com/" + Repo + "/main/scripts/Install-ISTUDIO.ps1";

            using (var client = new WebClient())
            {
                client.Headers.Add("User-Agent", "ISTUDIO-Launcher");
                client.DownloadFile(installerUrl, installerPath);
            }

            return Run(
                "powershell.exe",
                "-NoProfile -ExecutionPolicy Bypass -File " + Quote(installerPath) + " -Repo " + Quote(Repo),
                appDir
            );
        }
        catch (Exception error)
        {
            Console.Error.WriteLine();
            Console.Error.WriteLine("ISTUDIO could not start.");
            Console.Error.WriteLine(error.Message);
            Console.Error.WriteLine();
            Console.Error.WriteLine("Press any key to close.");
            Console.ReadKey(true);
            return 1;
        }
    }

    private static int Run(string fileName, string arguments, string workingDirectory)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = fileName,
            Arguments = arguments,
            WorkingDirectory = workingDirectory,
            UseShellExecute = false
        };

        using (var process = Process.Start(startInfo))
        {
            process.WaitForExit();
            return process.ExitCode;
        }
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
