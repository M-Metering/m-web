# Opens each .xlsx in a folder with Microsoft Excel (COM) and prints what Excel
# actually displays: cell text, stored value type and number format, plus
# freeze panes, autofilter and any cell showing scientific notation.
# Usage: powershell -NoProfile -File scripts/excel-check/verify-excel.ps1 <folder>
param([Parameter(Mandatory = $true)][string]$Folder)

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  Get-ChildItem -Path $Folder -Filter *.xlsx | ForEach-Object {
    $wb = $excel.Workbooks.Open($_.FullName, 0, $true)
    Write-Output "=================== $($_.Name)"
    foreach ($ws in $wb.Worksheets) {
      $ws.Activate()
      $used = $ws.UsedRange
      $rows = $used.Rows.Count
      $cols = $used.Columns.Count
      $frozen = $excel.ActiveWindow.FreezePanes
      $split = $excel.ActiveWindow.SplitRow
      Write-Output "--- sheet '$($ws.Name)' ${rows}x${cols}  freeze=$frozen splitRow=$split autofilter=$($ws.AutoFilterMode)"
      $sci = 0
      for ($r = 1; $r -le $rows; $r++) {
        $line = @()
        for ($c = 1; $c -le $cols; $c++) {
          $cell = $ws.Cells.Item($r, $c)
          $text = $cell.Text
          if ($text -match '\d[.,]?\d*E\+\d+' -or $text -match '^#+$') { $sci++ }
          $v = $cell.Value2
          $type = if ($null -eq $v) { 'empty' } elseif ($v -is [string]) { 'str' } else { 'num' }
          if ($r -eq 1) { $line += "$text" } else { $line += "$text [$type|$($cell.NumberFormat)]" }
        }
        Write-Output ("  r${r}: " + ($line -join ' | '))
      }
      Write-Output "  cells showing scientific notation or ####: $sci"
    }
    $wb.Close($false)
  }
} finally {
  $excel.Quit()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
